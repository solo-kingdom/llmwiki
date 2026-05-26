## Context

`merge-ingest-into-chat` 将 Raw Ingest UI 内嵌为 `DirectIngestPanel`，但提交仍走 `submitText` / `submitUpload`，绕过 session archive 与 Review 审阅闭环。Explore 结论：成品材料应作为 session 上下文追加，统一走 Chat 归档管线。

后端已支持非 stream message append：`POST .../messages` 不带 `stream=1` 且非 SSE Accept 时，仅持久化 user message，不触发 assistant 回复。前端 `appendIngestSessionMessage` 已存在于 `api.ts` 但未接入 UI。

Composer 当前布局：`[会话][模型][归档][直接归档] ... [附件][发送]`，控件过多且两条归档路径混淆。

## Goals / Non-Goals

**Goals:**

- 单一归档管线：所有 Web UI 材料摄入最终经 session → archive → review → apply
- 新增「添加上下文」Dialog：多块纯文本，非 stream append，不调 LLM
- 附件按钮左侧放置新按钮；删除 DirectIngestPanel 及所有 Web UI 直投入口
- 纯文本文件仍走 composer 附件（现有 LLM 摘要行为）
- 添加上下文不依赖 Provider；发送与归档仍依赖 Provider
- Legacy `/ingest` 与 query 重定向到新 Dialog

**Non-Goals:**

- 不改变 `submitText` / `submitUpload` API（扩展 clip 等外部入口保留）
- 不新增 silent attachment API（文件不走 context dialog）
- 不新增 `message_type` 字段（上下文消息与普通 user message 相同）
- 不改造 Jobs 页面或 ingest pipeline 语义

## Decisions

### 1. 组件：`ContextInputDialog` 替代 `DirectIngestPanel`

**选择**: 新建 `ContextInputDialog.tsx`，复用 `DirectIngestPanel` 的多文本块 UI 与 `composeTextBlocksToMarkdown`，去掉文件区、批次信息、Jobs 跳转。

**理由**: 最小 diff，文本块交互已验证；直投文件区不再需要（纯文本文件走附件）。

**备选**: inline composer 双提交 — 拒绝，长材料需要 Dialog。

### 2. AppContext：`appendContextMessage`

**选择**: 在 `AppContext` 新增 `appendContextMessage(content)`，调用 `api.appendIngestSessionMessage`，乐观追加 user bubble，不设置 `sessionBusy`，不创建 temp assistant。

**理由**: 与 `sendSessionMessage` 分离，避免误触 stream；添加上下文不应阻塞发送/停止。

### 3. Composer 按钮布局

**选择**:

```
... [归档] ··· [添加上下文] [附件] [发送]
```

「添加上下文」紧邻附件左侧（outline + `FileText` 图标）。

**理由**: 与用户 explore 结论一致；附件与上下文输入在语义上相邻。

### 4. Provider 门控

**选择**: 「添加上下文」按钮仅要求有效 `sessionId`（及 workspace），**不要求** `isReady`（Provider + Model）。Dialog 内提交同理。

**理由**: 用户可先贴材料，后配 Provider 再归档；归档按钮仍受 `isReady` 与 persisted user message 约束。

### 5. 路由 query 迁移

**选择**:

- 新增 `ADD_CONTEXT_QUERY = "addContext"`，`addContextHref()` → `/?addContext=1`
- `/ingest` 与 legacy `#ingest` 重定向到 `addContextHref()`
- 保留对 `?directIngest=1` 的兼容：视为 `addContext=1`（一次性迁移，可测）

**理由**: 平滑迁移 bookmark；避免 silent break。

### 6. 空状态 CTA

**选择**: 次要按钮文案改为「添加上下文材料」，打开 `ContextInputDialog`；主提示保留对话引导。

### 7. 后端

**选择**: 无后端代码变更；仅在 `ingest-session-api` spec 中文档化非 stream append 语义。

## Risks / Trade-offs

- **[Risk] 用户期望「直接归档」零步骤** → 新流程为「添加上下文 → 点归档」，多一步但获得 Review；空状态与按钮文案说明
- **[Risk] 大段粘贴性能** → 与 DirectIngestPanel 相同，无新风险
- **[Risk] `directIngest` deep link 失效** → 兼容重定向到 `addContext`
- **[Risk] 附件 .txt 仍触发 LLM 摘要，与 Dialog 零 LLM 不一致** → 设计刻意分工：粘贴零成本，文件走理解路径；README/i18n 说明

## Migration Plan

1. 实现 `ContextInputDialog` + `appendContextMessage`
2. 改造 `IngestChat` composer 与空状态
3. 更新 `wiki-routes`、 `WorkbenchLayout` 重定向
4. 删除 `DirectIngestPanel` 及测试，迁移/新增 `context-input-dialog.test.tsx`
5. 更新 i18n、README、spec deltas
6. 无数据库或 API 迁移

**Rollback**: 恢复 `DirectIngestPanel` 与 direct ingest 按钮即可。

## Open Questions

- 上下文消息气泡是否加「上下文」视觉标签？→ 建议 v1 不加，与普通 user 消息一致，降低实现成本
