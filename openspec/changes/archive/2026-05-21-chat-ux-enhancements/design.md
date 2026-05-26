## Context

Ingest Chat 页面由 `IngestChat.tsx` 渲染，消息通过 `AppContext` 的 `sendSessionMessage` → SSE 流接收。后端 `streamAssistantReply` 已正确检查 `r.Context().Err()`（`ingest_session.go:520`），客户端断开时标记 `stream_status=incomplete`。现有 `canRetryAssistant()` 已覆盖 `incomplete` 状态的 Retry 按钮逻辑。

消息数据存储在 SQLite `ingest_session_messages` 表（`internal/store/sqlite/ingest_sessions.go`），当前字段：id, session_id, role, content, message_type, attachment_id, stream_status, wiki_refs_json, created_at。归档逻辑在 `ArchiveIngestSession`（`ingest_session.go:786`），遍历所有消息组装 archive markdown，无过滤。

`WikiMentionPicker` 是独立组件（`web/src/components/WikiMentionPicker.tsx`），有自己的搜索输入框，使用 `searchDocuments()` API 做语义搜索。AppContext 中 `documents` state 已加载全量 `DocumentListItem`，含 filename, title, path, file_type。

## Goals / Non-Goals

**Goals:**

- 流式回复中可打断，UI 为 ChatGPT 风格 Stop 按钮
- 消息气泡外下方显示操作图标栏（复制 + 不归档 toggle）
- 不归档标记持久化到后端，归档时自动过滤
- textarea 中输入 `@` 触发 fzf 模糊搜索面板
- 三个功能完全独立，可分别实现和测试

**Non-Goals:**

- textarea 内 inline chip 样式化引用
- 搜索面板的键盘上下箭头导航
- 改变归档/Review 流程本身
- 三个功能的交叉联动

## Decisions

### Decision 1: AbortController 打断机制

前端使用 `AbortController` + `fetch signal` 实现打断：

```
sendSessionMessage() {
  const controller = new AbortController()
  abortControllerRef.current = controller
  fetch(url, { signal: controller.signal })
}

cancelStream() {
  abortControllerRef.current?.abort()
}
```

**为什么不用后端 cancel API**：后端已通过 request context 取消机制完美支持——客户端断开 TCP → Go `r.Context()` 被取消 → tool loop 和 stream 循环退出 → 消息标记 `incomplete`。无需新增 API。

**abort 后的状态恢复**：catch 块中检查 `AbortError`，将本地 assistant 消息标记为 `stream_status: "incomplete"`，然后从后端 reload 消息（后端已保存部分内容）。现有 `canRetryAssistant` 会显示 Retry 按钮。

### Decision 2: 消息图标栏位置与交互

图标位于消息气泡**外下方**，使用 `group-hover` 模式（与现有复制按钮一致的交互模式）：

```
<div className="group">                          ← hover 区域
  <div className="rounded-2xl ...">              ← 气泡
    消息内容
  </div>
  <div className="opacity-0 group-hover:opacity-100 ..."> ← 图标栏
    📋 复制   ☐ 不归档
  </div>
</div>
```

- 复制：从气泡右上角移到图标栏，移除现有绝对定位按钮
- 不归档：toggle 行为，点击后持久化，图标状态变为 `☑ 不归档` 并添加视觉提示（如消息添加半透明遮罩）
- 仅对 `user` 和 `assistant` 角色消息显示图标栏，不对 `system` 或 `attachment_summary` 显示

### Decision 3: exclude_from_archive 数据模型

**后端改动**：

1. SQLite migration：`ingest_session_messages` 表新增 `exclude_from_archive INTEGER NOT NULL DEFAULT 0`
2. `IngestSessionMessage` struct 新增 `ExcludeFromArchive bool` 字段
3. `scanIngestSessionMessage` 扩展 scan 列
4. 新增 `UpdateIngestSessionMessageExclude(id string, exclude bool) error` store 方法
5. 新增 API handler `PatchIngestSessionMessage`，路由 `PATCH /api/v1/ingest/sessions/{id}/messages/{messageId}`
6. `ArchiveIngestSession` 遍历消息时跳过 `ExcludeFromArchive == true` 的记录

**前端改动**：

1. `api.ts` 新增 `patchIngestSessionMessage(sessionId, messageId, { exclude_from_archive })`
2. `AppContext` 新增 `toggleMessageExclude(messageId)` 方法
3. `MessageBubble` 新增 prop：`excludeFromArchive` + `onToggleExclude`
4. `IngestSessionMessage` 类型新增 `exclude_from_archive?: boolean`

### Decision 4: @ 触发 fzf 搜索实现

**触发检测**：监听 textarea 的 `onChange`，当新输入的字符为 `@` 且前面是行首/空格/开头时，记录 `@` 的位置并打开搜索面板。面板打开后，`@` 后续输入的文字作为 fzf 搜索词。

**fzf 匹配**：使用 `fzf-ts` 或类似库（轻量，纯 JS，无 WASM 依赖），对 `documents` state 中的 wiki 页面做前端模糊匹配。匹配字段：`title` + `relative_path`。

**弹出面板定位**：面板浮在 textarea 上方，与输入框等宽，类似当前 `WikiMentionPicker` 的下拉面板。

**选择后行为**：
1. 从 textarea 文本中移除 `@query` 部分
2. 将选中文档添加到 `wikiRefs` state
3. 关闭面板
4. wiki refs 在 textarea 上方以 tag 形式显示（复用现有 tag 显示逻辑）

**关闭面板条件**：用户按 Escape、点击面板外区域、删除 `@` 字符、选择了一个文件

### Decision 5: fzf 库选择

使用 [`fzf`](https://github.com/junegunn/fzf/blob/master/README.md) 的 JS 移植版或 [`fuse.js`](https://fusejs.io/)：

| 方案 | 优点 | 缺点 |
|------|------|------|
| fuse.js | 成熟稳定、文档好、支持加权搜索 | 非严格 fzf 算法，偏向全文搜索 |
| fzf (npm) | 严格 fzf 算法 | 社区 JS 移植版质量参差 |

**选择 fuse.js**：wiki 页面数量通常 < 500，fuse.js 性能足够；其模糊匹配行为用户可理解；维护活跃，API 简洁。配置项：`threshold: 0.4`（中等模糊度）、`keys: ['title', 'path']`（双字段搜索）。

### Decision 6: 路由与 API 设计

新增路由：

```
PATCH /api/v1/ingest/sessions/{id}/messages/{messageId}
Body: { "exclude_from_archive": true }
Response: { "message": IngestSessionMessage }
```

该路由注册在 `internal/server/server.go` 的 sessions 子路由组中（`ingest_session.go:206` 同级）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Abort 后端可能仍在执行 tool loop | 后端 `ctx.Err()` 检查在每个 token 和 tool call 前都会触发，延迟 < 1 个 LLM 请求周期 |
| `exclude_from_archive` migration | 使用 `addColumnIgnoreDuplicate` 模式（项目已有先例 `migrate_session_references.go`），安全幂等 |
| 前端 fzf 匹配 wiki 页面列表可能很大 | `documents` state 已加载全量文档；wiki 通常 < 500 页，fuse.js 可在 < 5ms 内完成匹配 |
| textarea 中 `@` 检测与 IME 冲突 | 仅在 `onChange` 时检测实际输入的 `@` 字符，不依赖 `keydown`；IME composing 期间不会产生 `@` |
| 消息图标栏可能影响消息间距 | 图标栏使用 `h-0 overflow-visible` 技巧或固定小高度，不占用额外空间 |

## Migration Plan

1. 后端：SQLite migration + PATCH handler + 归档过滤 + 测试
2. 前端功能 1：Stop 按钮（AbortController）
3. 前端功能 2：消息图标栏（复制 + 不归档）
4. 前端功能 3：@ 触发 fzf 搜索
5. 每个功能独立测试和验证

无破坏性变更；PATCH 端点为新增，不影响现有 API。
