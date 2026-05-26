## 1. Backend — exclude_from_archive 字段与 API

- [x] 1.1 新增 SQLite migration：`internal/store/sqlite/migrate_message_exclude.go`，使用 `addColumnIgnoreDuplicate` 为 `ingest_session_messages` 表添加 `exclude_from_archive INTEGER NOT NULL DEFAULT 0` 列
- [x] 1.2 `IngestSessionMessage` struct 新增 `ExcludeFromArchive bool` 字段（`internal/store/sqlite/ingest_sessions.go`）
- [x] 1.3 扩展 `scanIngestSessionMessage` 增加 `ExcludeFromArchive` 列扫描
- [x] 1.4 扩展 `CreateIngestSessionMessage` INSERT 语句包含 `exclude_from_archive` 列
- [x] 1.5 新增 store 方法 `UpdateIngestSessionMessageExclude(id string, exclude bool) error`
- [x] 1.6 新增 API handler `PatchIngestSessionMessage`（`internal/api/ingest_session.go`），接受 `{ exclude_from_archive: bool }`，调用 store 更新
- [x] 1.7 注册路由 `r.Patch("/{id}/messages/{messageId}", s.api.PatchIngestSessionMessage)`（`internal/server/server.go`）
- [ ] 1.8 为 PATCH handler 添加 API 测试

## 2. Backend — 归档逻辑过滤

- [x] 2.1 修改 `ArchiveIngestSession`（`ingest_session.go:830-842`），在遍历消息组装 `archiveMsgs` 时跳过 `ExcludeFromArchive == true` 的记录
- [ ] 2.2 为归档过滤逻辑添加测试：创建含 excluded 消息的 session，归档后验证 archive markdown 不含被排除的消息

## 3. Frontend — Stop 按钮（打断模型回复）

- [x] 3.1 `AppContext` 新增 `abortControllerRef = useRef<AbortController | null>(null)`
- [x] 3.2 修改 `sendSessionMessage`：创建 `AbortController`，将 `signal` 传入 `api.streamIngestSessionMessage`
- [x] 3.3 修改 `api.streamIngestSessionMessage` 和 `consumeSessionSSE`：接受可选 `signal` 参数，传给 `fetch`
- [x] 3.4 `AppContext` 新增 `cancelStream()` 方法：调用 `abortControllerRef.current.abort()`，设置 `activeStreamRef = false`，`sessionBusy = false`
- [x] 3.5 `sendSessionMessage` 的 catch 块中检测 `AbortError`：将 assistant 消息标记为 `incomplete`，从后端 reload 消息
- [x] 3.6 `IngestChat` 发送按钮：`sessionBusy` 时显示 Stop 图标 + "停止" 文案，点击调用 `cancelStream()`
- [x] 3.7 添加 i18n：`chat.stop`（en: "Stop", zh: "停止"）
- [x] 3.8 同样修改 `retrySessionMessage` 支持 AbortController

## 4. Frontend — 消息图标栏

- [x] 4.1 扩展前端 `IngestSessionMessage` 类型，新增 `exclude_from_archive?: boolean`
- [x] 4.2 `api.ts` 新增 `patchIngestSessionMessage(sessionId, messageId, patch)` 函数
- [x] 4.3 `AppContext` 新增 `toggleMessageExclude(messageId)` 方法：调 API → 更新本地 `sessionMessages` 中对应消息的字段
- [x] 4.4 `MessageBubble` 新增 props：`excludeFromArchive`、`onToggleExclude`
- [x] 4.5 重构 `MessageBubble` 布局：移除右上角复制按钮（绝对定位），在气泡外下方添加图标栏容器
- [x] 4.6 图标栏实现：`div.opacity-0.group-hover:opacity-100` 包含复制按钮 + 不归档 toggle 按钮
- [x] 4.7 不归档 toggle：点击调用 `onToggleExclude`，视觉状态变化（图标切换 + 可选半透明遮罩）
- [x] 4.8 添加 i18n：`chat.exclude_from_archive`（en: "Exclude from archive", zh: "不归档"）、`chat.excluded_from_archive`（en: "Excluded from archive", zh: "已排除归档"）
- [x] 4.9 更新 `IngestChat` 向 `MessageBubble` 传递新 props

## 5. Frontend — @ 触发 fzf 搜索

- [x] 5.1 安装 `fuse.js` 依赖（`npm install fuse.js`）
- [x] 5.2 新建 `web/src/lib/fuzzy-search.ts`：封装 fuse.js 实例，接受 `DocumentListItem[]`，暴露 `search(query: string): DocumentListItem[]` 方法
- [x] 5.3 重写 `WikiMentionPicker` 或新建 `WikiMentionTrigger` 组件：
  - 接受 `value`（当前 wikiRefs）、`onChange`、`documents`（全量文档列表）、`inputRef`（textarea ref）
  - 监听 textarea 的 `onChange` 和 `onKeyDown`
  - 检测 `@` 输入：记录 `@` 位置，打开搜索面板
  - 追踪 `@` 后续文字作为搜索词
  - 调用 `fuzzy-search.ts` 进行前端模糊匹配（过滤 `source_kind=wiki` 或 path 含 `wiki/`）
  - 渲染弹出面板：匹配结果列表，点击选择
  - 选择后：清除 textarea 中 `@query` 文本，调用 `onChange` 添加 wikiRef
  - Escape / 失焦 / 删除 `@` 时关闭面板
- [x] 5.4 移除现有 `WikiMentionPicker` 的独立搜索输入框
- [x] 5.5 保留 textarea 上方的 wiki refs tag 显示区域
- [x] 5.6 `IngestChat` 将 `documents` 传给新组件，将 textarea ref 共享给新组件
- [x] 5.7 添加 i18n：`chat.wiki_mention_searching`（en: "Searching…", zh: "搜索中…"）

## 6. 收尾

- [x] 6.1 跑 `go test ./internal/...` 确保后端测试通过
- [x] 6.2 跑 `npm test`（web）确保前端测试通过
- [x] 6.3 更新 `ingest-chat.test.tsx` 覆盖三个新功能的测试用例
- [ ] 6.4 手动验证：Stop 按钮打断、图标栏 hover + 不归档 toggle、@ 触发搜索 + 模糊匹配
