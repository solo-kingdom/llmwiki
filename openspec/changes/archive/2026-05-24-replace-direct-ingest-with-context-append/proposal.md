## Why

当前 Chat 内的「直接归档」（DirectIngestPanel）绕过 session 与 Review 审阅闭环，直投 `submitText` / `submitUpload` 进入 Jobs 管线，与「对话 → 归档 → 审阅 → 写入 wiki」形成两套并行路径，用户心智混乱且成品材料无法享受 archive review gate。应统一为单一归档管线：粘贴/输入的纯文本作为 session 上下文追加，再走现有 Chat 归档能力。

## What Changes

- **移除** Chat 内 DirectIngestPanel 及 composer「直接归档」按钮、空状态「直接归档材料」CTA
- **新增** composer 附件按钮左侧的「添加上下文」按钮，打开 Dialog 输入多块纯文本，提交后调用非 stream 的 session message append API，**不触发 LLM 回复**
- **保留** composer 附件上传：纯文本文件（如 `.txt` / `.md`）仍通过附件路径上传（现有 LLM 摘要行为不变）
- **更新** legacy `/ingest` 与 `?directIngest=1` 重定向为打开「添加上下文」Dialog（`?addContext=1`）
- **明确** 添加上下文不依赖 Provider 配置；发送对话与归档仍依赖 Provider
- 后端 `submitText` / `submitUpload` API **不变**（浏览器扩展等外部入口继续使用）

## Capabilities

### New Capabilities

（无——本变更在现有 Chat 归档与 session API 能力上扩展 UI 入口，不引入新 capability。）

### Modified Capabilities

- `ingest-chat-ui`：删除 Direct ingest panel 需求；新增 context append dialog 入口、空状态 CTA、composer 按钮布局
- `web-ui`：更新 legacy ingest 路由重定向行为（打开 context dialog 而非 direct ingest panel）
- `ingest-session-api`：明确非 stream message append 为 context-only 追加（持久化 user message，不触发 assistant 回复）

## Impact

- **前端**: 删除 `DirectIngestPanel.tsx` 及相关测试；新增 `ContextInputDialog`（或等价组件）；改造 `IngestChat.tsx`、`AppContext.tsx`（`appendContextMessage`）、`wiki-routes.ts`、`WorkbenchLayout.tsx`；更新 i18n（zh/en）
- **测试**: 删除/迁移 `direct-ingest-panel.test.tsx`；更新 `ingest-chat.test.tsx`、`wiki-routes.test.ts`、`app-nav.test.tsx`
- **文档**: 更新 README 中直接归档描述
- **Breaking**: 移除 Web UI 内 direct ingest 工作流；`?directIngest=1` query 废弃，替换为 `?addContext=1`
- **Non-breaking**: 后端 ingest jobs API、session archive API、附件 API 语义不变
