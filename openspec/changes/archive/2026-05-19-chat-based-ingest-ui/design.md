## Context

`web-default-data-ingestion` 已将 Web 默认入口设为 Ingest Hub，并提供 conversation/text/upload 三类 ingest job API。前端 `IngestHub` 实现为居中大 textarea +「提交摄入」，本质是**一次性粘贴归档**，无多轮消息、无流式助手回复、无会话级附件理解。后端 `NormalizeConversation` 将整段文本写入 `raw/sources/web-ingest/*.md` 后入队，管线两步（分析 + 生成 wiki）已可用。

本变更在既有 job 模型与文件真理边界上叠加**摄入会话层**，将 UI 心智对齐「先聊清楚，再归档」。

## Goals / Non-Goals

**Goals:**

- Ingest 页呈现标准聊天布局（消息流 + 输入栏 + 附件 + 归档）。
- 导航文案 `Ingest Hub` → `Ingest`。
- 会话内多轮 user/assistant 消息；助手回复支持流式展示。
- 附件上传后产生「理解消息」并纳入后续上下文。
- 「归档」生成会话快照 → raw 落盘 → 创建 ingest job → 现有管线更新 wiki。
- 归档前可选确认（标题、来源备注）；归档后跳转 Jobs 或内联展示 job 状态。

**Non-Goals:**

- 多人实时协同、会话分享链接。
- 替代 MCP/CLI 摄入路径。
- 新建外部 OCR/解压引擎（沿用 capabilities 与现有 tier）。
- 完整对话历史无限持久化策略（v1 可会话级文件 + SQLite 元数据，保留清理策略为开放项）。

## Decisions

### 1) 会话模型：服务端权威 + 文件系统 raw

- **决策**：新增 `ingest_session` 实体（SQLite 存 id、title、status、created_at、paths）；消息与附件 manifest 以 JSON/Markdown 写入 `raw/sources/web-ingest/sessions/<session-id>/`。
- **原因**：符合 filesystem source of truth；删库可重建索引，会话 raw 仍可恢复。
- **备选**：仅 SQLite 存消息 — 违反真理边界，不采纳。

### 2) 聊天 API：REST + SSE 流式

- **决策**：
  - `POST /api/v1/ingest/sessions` 创建会话
  - `POST .../sessions/{id}/messages` 发送用户消息（可含 attachment_ids）
  - `GET .../sessions/{id}/messages` 列表
  - `POST .../sessions/{id}/messages/stream` 或同路径 `Accept: text/event-stream` 获取助手流式回复并持久化
  - `POST .../sessions/{id}/attachments` multipart 上传
  - `POST .../sessions/{id}/archive` 冻结快照并 `createQueuedIngestJob(input_type=session_archive)`
- **原因**：与现有 chi + JSON API 一致；SSE 实现成本低。
- **备选**：WebSocket — 更强实时性但复杂度更高，v1 不采用。

### 3) 归档输入：会话快照 Markdown

- **决策**：归档时将消息流序列化为单一 Markdown（含 frontmatter：session_id、title、archived_at、附件列表），路径如 `raw/sources/web-ingest/sessions/<id>/archive-<timestamp>.md`，作为 job `source_path`。
- **原因**：复用 `NormalizeConversation` / 管线文本处理路径，最小改动 ingest pipeline。
- **备选**：每条消息单独 job — 碎片化，难维护 wiki 一致性。

### 4) 附件理解时机：上传后异步轻理解

- **决策**：附件落盘后触发轻量理解（图片：vision/描述 prompt；文档：沿用 extract tier），结果写为 `role=assistant` 的 `type=attachment_summary` 消息。
- **原因**：满足「传图即见理解」；归档时上下文已含摘要。
- **备选**：仅归档时理解 — 聊天中反馈差。

### 5) UI 信息架构

- **决策**：
  - 默认进入 Ingest 即**当前活跃会话**（无会话则自动创建）。
  - 主按钮：**发送**（次要样式）、**归档**（主 CTA）。
  - 侧栏或顶部可选「新会话」；历史会话列表 v1 可简化为仅当前会话（开放项）。
  - 移除独立「文本」模态框为主路径；长文粘贴作为用户消息内容。
- **原因**：对齐 ChatGPT 类心智；减少入口分裂。

### 6) 与现有 conversation API 关系

- **决策**：保留 `POST /ingest/jobs/conversation` 供自动化/兼容；Web 主路径改走 session archive。不在 v1 删除旧 API。
- **原因**：降低破坏性；MCP/脚本可继续使用。

## Risks / Trade-offs

- [风险] 长会话 token 超限 → Mitigation：发送前按条数/字符截断历史；归档前可选「摘要压缩」步骤（非 v1 必做）。
- [风险] 流式中断导致助手消息不完整 → Mitigation：持久化 partial 消息并标记 `incomplete`，允许重试。
- [风险] 附件理解失败阻塞体验 → Mitigation：失败仍以 assistant 消息返回 error_code + remediation，不阻塞发送与归档。
- [权衡] 会话存储增加磁盘与 SQLite 表 — 换取可追溯与更好 UX。

## Migration Plan

1. 后端：session 表 + API + 归档归一化 + `input_type=session_archive`。
2. 前端：新 `IngestChat` 组件，App 标签改名；保留旧 `IngestHub` 特性标志切换一期（可选，建议直接替换）。
3. LLM：摄入会话 system prompt + 流式 handler。
4. 测试：API 单测、归档 E2E、UI 关键路径测试。
5. 回滚：feature flag `ingest.chat.enabled=false` 时回退旧 textarea UI（若实现 flag）；否则 git revert。

## Open Questions

- 是否 v1 支持多会话列表与切换，还是仅单活跃会话？
- 归档确认页是否允许用户编辑生成的 wiki 标题/目录？
- 图片理解是否依赖当前配置的 vision 模型，还是纯文本 fallback？
