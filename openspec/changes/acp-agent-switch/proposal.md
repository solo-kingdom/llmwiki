## Why

llmwiki 现在只有一条自研 agent 路径：`provider_instances`（凭据）→ `llm.ClientFromInstance` → `ingest.RunSessionChatToolLoop`（tool loop）→ SSE 流 + `ingest_session_messages` 持久化。这条路径的能力上限由 llmwiki 自己实现的 tool 集合（`mcp.BuiltinToolDefinitionsForMode` + chat scope MCP）决定：只读、无终端、无多步自主编辑。

用户已经在本机装了通用编码 agent（Claude Code / Codex / Gemini CLI 等），这些 agent 通过 **ACP（Agent Client Protocol）** 暴露统一的 JSON-RPC 2.0 stdio 接口。让 llmwiki 作为 ACP **client** 去驱动它们，可以直接复用这些 agent 的规划、多轮工具调用与文件操作能力，而不需要在 llmwiki 内部重造。

同时必须保留自研路径：它是 ingest / archive / review / job pipeline 的既有依赖，也是没有本机 agent CLI 时的唯一可用路径。因此本变更的核心不是"替换"，而是**在 session 级别引入可切换的 agent runtime 抽象**，让 native 与 ACP 两条路径共存、互不污染。

## What Changes

- **新增 `agent-runtime` capability**：定义 `internal/agentruntime` 稳定接缝（`Runtime` / `PromptRequest` / `EventSink` / `PromptResult`），native 与 ACP 各自实现。`internal/api/ingest_session.go` 只依赖该接口，ACP 协议细节不进入 ingest 业务层。
- **新增 `internal/acp` 包**：llmwiki 运行时**直接实现** ACP client（JSON-RPC 2.0 over stdio），覆盖 `initialize`、`session/new`、`session/prompt`、`session/update`、`session/cancel`、`session/request_permission`。不引入 ACP SDK 依赖，不把 `acpx` 作为运行时依赖。
- **新增通用 ACP agent 配置**：`app_config.acp_agents_json`，版本化 JSON 文档（形态对齐 `internal/mcp/config.go` 的 `mcp_servers_json`），字段为 `command` / `args` / `env_passthrough` / `cwd_policy` / 超时 / 权限策略。不硬编码任何具体 agent。
- **新增凭据边界**：配置**只声明环境变量名**（`env_passthrough`），不存在任何存放环境变量值的字段；值始终来自 llmwiki 进程环境。子进程环境按白名单构造：`env_passthrough` 中在当前进程环境已存在的变量 + 强制 `PATH`，llmwiki 进程的其他环境变量一律不透传。`command` 与 `args` 禁止夹带凭据，校验命中即拒绝并指引改用 `env_passthrough`。API 响应对 `env_passthrough` 只回 `{name, present}`，永不回值。
- **新增 session 级 runtime 选择**：`ingest_sessions` 增加 `agent_kind`（`native`|`acp`，默认 `native`）与 `acp_agent_id`；`app_config` 增加 `default_agent_kind` / `default_acp_agent_id` 作为"新建 session 的默认 / 最近使用"。
- **新增 ACP agent 管理 API**：`GET /api/v1/acp-agents`、`POST /api/v1/acp-agents/check`。
- **扩展现有 API**：`POST|PATCH /api/v1/ingest/sessions` 接受 `agent_kind` / `acp_agent_id`；`GET|PUT /api/v1/settings` 读写三个新配置键；`GET /api/v1/health` 增加 `acp_enabled`。
- **扩展 SSE 事件词表**：新增 `thought`、`plan`、`permission` 三个事件；`token` / `tool_start` / `tool_done` / `warning` / `error` / `done` 语义不变，前端旧逻辑对未知事件天然忽略。
- **复用现有持久化真相源**：ACP 的 `agent_message_chunk` 写入 `ingest_session_messages.content`；`agent_thought_chunk` / `tool_call` / `plan` / 权限决策 / `stopReason` 写入 `session_message_events`。不新建会话表。
- **扩展前端**：`types.ts` / `lib/api.ts` / `AppContext` / `ModelSelectDialog` / `IngestChat` / `SessionControls` / `SettingsPage` 增加 runtime 维度；ACP 模式下输入框守卫不再依赖 provider API key。
- **部署默认不变**：镜像不预装任何 ACP CLI，`default_agent_kind` 默认 `native`，现有 lnv 部署零行为变化；ACP 作为可选镜像变体（`lwiki-acp`）单独提供。

## Capabilities

### New Capabilities

- `agent-runtime`：agent runtime 抽象与 ACP client 运行时。包含 `Runtime` 接口契约、ACP 配置模型与校验（含凭据边界校验）、进程生命周期（懒启动/复用/崩溃/超时/取消/清理）、权限决策矩阵、cwd 隔离与路径越界防护、日志脱敏、可用性探测。

### Modified Capabilities

- `llm-integration`：明确 `llm.ClientFromInstance` 只服务 native runtime；ACP session 不构造 LLM client，不因 provider instance 缺失而报错。
- `ingest-session-api`：session 增加 `agent_kind` / `acp_agent_id` 字段与更新入口；ACP turn 的流式事件、持久化、失败恢复、取消行为纳入契约。
- `settings-api`：新增 `acp_agents_json`、`default_agent_kind`、`default_acp_agent_id` 配置键与校验；新增 ACP agent 列表与探活端点。
- `web-ui`：Settings 新增 ACP Agents 管理卡片；模型选择对话框升级为 runtime 选择；聊天输入守卫按 runtime 分支；session 列表显示 runtime 标识。

## Impact

- **数据库**：`ingest_sessions` 新增 `agent_kind TEXT NOT NULL DEFAULT 'native'`（CHECK `IN ('native','acp')`）与 `acp_agent_id TEXT NOT NULL DEFAULT ''`；新增 `internal/store/sqlite/migrate_session_agent_runtime.go` 并接入 `DB.Migrate()`。现有行默认 native，无需重建 workspace。
- **Go 后端（新增）**：`internal/acp/`（`config.go`、`jsonrpc.go`、`process.go`、`client.go`、`events.go`、`permission.go`、`manager.go`、`cwd.go`、`sanitize.go`、`check.go`）；`internal/agentruntime/`（`runtime.go`、`native.go`、`acp.go`、`resolve.go`）；`internal/api/acp_agents.go`。
- **Go 后端（修改）**：`internal/api/api.go`（新增 `sessionAgentRuntime`、SSE `EventSink` 适配）、`internal/api/ingest_session.go`（`CreateIngestSession`、`UpdateIngestSessionHandler`、`streamSessionReply`、`streamAssistantReply`、`RetryIngestSessionMessage`）、`internal/api/settings.go`（`settingsResponse`、`allowedKeys` 与校验）、`internal/server/server.go`（路由、`handleHealth`、`Shutdown` 时关闭 ACP 进程）、`cmd/llmwiki/serve.go`（构造并注入 `acp.Manager`）、`internal/store/sqlite/{ingest_sessions.go,db.go}`。
- **前端类型/API**：`web/src/types.ts` 新增 `AgentKind`、`ACPAgent`、`ACPAgentCheckResult`，扩展 `IngestSession`、`SessionListItem`、`Settings`；`web/src/lib/api.ts` 新增 `listACPAgents`、`checkACPAgents`，扩展 `createIngestSession`、`updateIngestSession`。
- **前端状态/UI**：`web/src/context/AppContext.tsx` 新增 `acpAgents` / `loadACPAgents` / `updateSessionAgent`；`ModelSelectDialog.tsx`、`IngestChat.tsx`、`SessionControls.tsx`、`SettingsPage.tsx`；`web/src/i18n/messages/{zh,en}.ts` 新增 `settings.acp.*`、`chat.agent.*`、`model.runtime.*` 文案。
- **测试**：新增 `internal/acp/*_test.go`、`internal/agentruntime/*_test.go`；扩展 `internal/api/ingest_session_test.go`、`internal/api/settings_test.go`、`internal/store/sqlite/ingest_sessions_test.go`；新增 `web/src/acp-agents.test.tsx`，扩展 `web/src/settings-page.test.tsx`、`web/src/ingest-chat.test.tsx`。
- **文档**：`README.md`（ACP 章节、新端点、health 字段）、`docs/` 新增 `16-acp-agent-runtime.md`。
- **部署（lnv）**：默认镜像与 compose 不变；新增可选 `lwiki-acp` 镜像变体说明与 `env_file` 凭据注入约定（凭据只进 llmwiki 进程环境，不入仓、不进 compose 明文、不进 `acp_agents_json`）。工作区知识库 `~/code/projects/llmwiki/notes/` 追加一条 ACP 部署记录（本仓库外，随实现同步）。
- **不做的事**：不改 ingest job pipeline（`internal/ingest/pipeline.go`、`processor.go`、review/archive 链路仍固定走 native）；不实现 `fs/*` 与 `terminal/*` client 方法；不实现交互式权限审批 UI。
