## Why

当前 Web 默认入口虽已是摄入优先，但 `Ingest Hub` 仍以「单一大文本框 + 提交摄入」为主，缺少与大模型持续对话、附件理解与「归档」的完整心智模型。用户真实录入路径是：先围绕话题多轮探索（含图片/文件），确认后再一次性沉淀到 wiki；现有交互与这一路径不匹配，且命名 `Ingest Hub` 偏工具化，不利于作为日常主界面。

## What Changes

- 将导航与页面命名从 **Ingest Hub** 统一为 **Ingest**，默认视图保持摄入优先。
- 将 Ingest 默认界面重构为**类聊天会话 UI**：消息流（用户/助手）、底部输入区、附件区，支持文本、图片与文件。
- 引入**会话（session）**概念：用户在单会话内多轮对话；会话内容在归档前可持久化，归档时冻结快照。
- 将主 CTA 从「提交摄入」改为**「归档」**：归档时保存完整对话为 raw、创建 ingest job、经现有管线更新 wiki。
- 支持会话中途上传附件：上传后触发理解（摘要/结构化说明）并回显为助手消息；用户可继续对话或直接归档。
- 保留 Jobs / Wiki / Settings 导航；文本直投、批量上传等能力可收敛为聊天附件或次级入口（见 design）。
- **BREAKING**（产品语义）：`ingest-hub-ui` 中「单 textarea 粘贴即提交」不再是主路径；主路径变为会话 + 归档。

## Capabilities

### New Capabilities

- `ingest-session-api`: 摄入会话的创建、消息追加、附件关联、归档入队及会话 raw 落盘 API。
- `ingest-chat-ui`: Ingest 页聊天式交互（消息列表、发送、附件、归档按钮、归档确认与进度反馈）。

### Modified Capabilities

- `web-ui`: 全局导航标签由 `Ingest Hub` 改为 `Ingest`；默认 tab 仍为 ingest。
- `ingest-hub-ui`: 由「沉浸式粘贴区」改为以聊天会话为主；原粘贴/拖放能力迁移或降级为会话内能力（delta 覆盖）。
- `llm-integration`: 为 Web 摄入会话提供流式对话调用与上下文组装（含附件理解结果）。
- `ingest-pipeline`: 接受「会话归档快照」作为规范化输入，与 conversation/text/upload 并列或扩展 input 类型。

## Impact

- 前端：`web/src/App.tsx` 标签文案；`IngestHub` 重构或替换为 `IngestChat`；新增会话状态、消息组件、归档流程 UI；`lib/api.ts` 扩展 session/archive 端点。
- 服务端：新增 `internal/api/ingest_session.go`（或等价）及路由；SQLite 表或文件存储会话元数据；归档复用现有 ingest job 队列。
- 存储：`raw/sources/web-ingest/` 下按会话保存对话 transcript 与附件引用；归档快照版本化。
- LLM：摄入场景专用 system prompt；流式 SSE/WebSocket 或 chunked 响应供前端渲染。
- 测试：前端组件测试、API 集成测试、归档端到端（会话 → raw → job → wiki）。
