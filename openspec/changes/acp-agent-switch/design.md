## Context

### 现状调用链（native）

会话聊天的完整链路目前是：

1. `internal/server/server.go` 路由 `POST /api/v1/ingest/sessions/{id}/messages` → `api.AppendIngestSessionMessage`。
2. `stream=1` 或 `Accept: text/event-stream` 时走 `api.streamSessionReply`（`internal/api/ingest_session.go:330`）。
3. `api.sessionLLMClient(session)`（`internal/api/api.go:72`）读 `session.LLMInstanceID` / `session.LLMModel`，缺失时回退 `app_config` 的 `last_instance_id` / `last_model`，再交给 `llm.ClientFromInstance(db, instanceID, model)`（`internal/llm/instance_client.go:16`）。该函数在 instance 不存在或 `api_key` 为空时返回 error → handler 直接 400。
4. 写入 user message + streaming assistant message（`ingest_session_messages`），发 SSE `user_message` / `assistant_start`。
5. `api.streamAssistantReply` 组装 prompt（`ingest.AssembleIngestChatMessages`）、解析 related subset（`ingest.ContextResolver`）、建 debug recorder（`ingest.NewSessionMessageRecorder` → `session_message_events`）、建 tool executor（`ingest.NewChatWikiExecutor` + `mcp.Router`），跑 `ingest.RunSessionChatToolLoop`。
6. tool loop 失败则 `sendEvent("warning", {code:"tool_loop_failed"})` 并回退 `api.streamSessionChatDirect`（`client.StreamChat`）。
7. 成功后按 48 rune 分块发 `token`，节流写 `UpdateIngestSessionMessageContent`，最后发 `done`。

前端侧：`AppContext.applyAssistantStreamEvent` 处理 `user_message` / `assistant_start` / `token` / `tool_start` / `tool_done` / `done` / `error` / `warning`，未知事件被静默忽略。`IngestChat` 的 `isReady = !!sessionId && !!effectiveInstanceId && !!effectiveModel` 直接控制 `textareaDisabled`。

### 现有可复用范式

- **配置**：`internal/mcp/config.go` 的 `mcp_servers_json` 是"版本化 JSON 存 `app_config` + `ParseConfig` 带 JSON path 的 `ValidationError` + `CanonicalJSON` 规范化落库"的成熟范式。ACP 配置直接复用这套形态与 `PUT /api/v1/settings` 的校验时机。
- **探活**：`internal/mcp/check.go` 的 `CheckServers` + `POST /api/v1/settings/mcp/check`（支持传未保存的 JSON 探测）是探活端点范式。
- **脱敏**：`ingest.SanitizePayload`（`internal/ingest/job_events.go:41`，落库前剔除 `api_key`/`authorization`/`x-api-key` 并截断 32KB）与 `activity.SanitizeDetails`（`internal/activity/sanitize.go`）。
- **迁移**：`sqlite.MigrateAddSessionMode`（`internal/store/sqlite/ingest_sessions.go:142`）演示了 `pragma_table_info` 探测 + `ALTER TABLE ... ADD COLUMN ... CHECK(...)` 的幂等迁移。
- **调试事件**：`session_message_events`（`internal/store/sqlite/session_msg_events.go`）已有按 message 保留上限、`GET /messages/{messageId}/events` 端点、`MessageDebugDialog` 前端展示。

### ACP 协议事实（已核对 agentclientprotocol.com，v1）

- 传输：JSON-RPC 2.0 over stdio，换行分隔。
- `initialize`：client 发 `{protocolVersion: 1, clientCapabilities: {fs:{readTextFile,writeTextFile}, terminal}, clientInfo:{name,title,version}}`；agent 回 `{protocolVersion, agentCapabilities:{loadSession, promptCapabilities:{...}, mcpCapabilities:{...}}, agentInfo, authMethods}`。若 agent 返回的版本 client 不支持，client SHOULD 断开。
- `session/new`：`{cwd: <绝对路径>, mcpServers: []}` → `{sessionId}`。
- `session/prompt`：`{sessionId, prompt: ContentBlock[]}` → `{stopReason}`。所有 agent 必须支持 `ContentBlock` 的 `text` 与 `resource_link`。
- `session/update`（agent→client notification）：`{sessionId, update:{sessionUpdate: "user_message_chunk"|"agent_message_chunk"|"agent_thought_chunk"|"tool_call"|"tool_call_update"|"plan"|"available_commands_update"|"current_mode_update"|"usage_update", ...}}`。
- `session/cancel`（client→agent notification）：`{sessionId}`；agent 必须最终以 `stopReason: "cancelled"` 回 `session/prompt`。
- `session/request_permission`（agent→client request）：`{sessionId, toolCall: ToolCallUpdate, options: [{optionId, name, kind}]}`，`kind ∈ allow_once|allow_always|reject_once|reject_always` → 回 `{outcome: {outcome:"selected", optionId}}` 或 `{outcome:{outcome:"cancelled"}}`。
- `StopReason ∈ end_turn|max_tokens|max_turn_requests|refusal|cancelled`。
- `ToolCallUpdate.kind ∈ read|edit|delete|move|search|execute|think|fetch|other`（`switch` 必须有 default）。
- `fs/read_text_file`、`fs/write_text_file`、`terminal/*` 是**client 侧**方法，仅在 `clientCapabilities` 声明为 true 时 agent 才可调用。

## Goals / Non-Goals

**Goals**

- 引入 deep module 接缝 `internal/agentruntime.Runtime`，让 `internal/api` 对 native / ACP 无差别调用，ACP 协议细节封死在 `internal/acp`。
- ACP 配置对任意 agent 通用：只描述"怎么启动一个进程"和"给它什么权限"，不含任何 agent 品牌逻辑。
- 凭据零明文落库：配置只声明环境变量名，值来自 llmwiki 进程环境；配置里不存在任何能放下一个环境值的字段。
- 单一会话真相源：ACP 产出全部落到既有 `ingest_session_messages` + `session_message_events`，刷新后历史可见。
- 默认安全：只读、非交互权限决策、cwd 限定在 workspace 内、client 不开放 `fs/*` 与 `terminal/*`。
- 向后兼容：现有 session 与部署行为零变化。

**Non-Goals**

- 不让 ingest job pipeline（`internal/ingest/pipeline.go`、`review_processor.go`、`processor.go`）走 ACP。job 侧固定 native。
- 不实现 client 侧 `fs/read_text_file` / `fs/write_text_file` / `terminal/*`。
- 不实现交互式权限审批 UI（human-in-the-loop）。
- 不实现 `session/resume` / `session/load` / `session/list` / `session/set_config_option` / `elicitation/*` / `authenticate`。
- 不支持 ACP over HTTP/SSE 或远程 agent，只支持本机 stdio 子进程。
- 不做 ACP v2（`state_update` / `session/set_config_option` 语义重构）。
- 不把 `acpx` 变成运行时依赖。

## Decisions

### D1: llmwiki 运行时直接实现 ACP client，不经 `acpx`

**选择**：新建 `internal/acp` 包，用标准库 `os/exec` + `encoding/json` + `bufio` 实现换行分隔的 JSON-RPC 2.0 stdio client。`go.mod` 不新增依赖。

**理由**：

- ACP 官方 SDK 只有 Rust 与 TypeScript，没有 Go；引入 Node 运行时只为跑一个协议桥，会把 186MB 的部署镜像变成 400MB+，且多一层进程与故障面。
- 协议表面很小：3 个 client→agent request（`initialize`、`session/new`、`session/prompt`）+ 1 个 notification（`session/cancel`）+ 2 个 agent→client 入站（`session/update` notification、`session/request_permission` request）。手写实现 ~500 行，可测试性远好于包一层 CLI。
- `acpx` 这类工具的价值在**开发期编排与调试**（手工连一个 agent、看原始报文），这属于开发工具链，写进 `docs/16-acp-agent-runtime.md` 的"调试"小节即可，不进运行时。

**备选**：spawn `acpx` 作为中间层 → 否决，多一层依赖、多一层版本漂移、报文语义仍要自己解。

### D2: 稳定接缝 = `internal/agentruntime.Runtime`

```go
package agentruntime

const (
    KindNative = "native"
    KindACP    = "acp"
)

// EventSink 接收一次 turn 内的增量输出。实现方负责 SSE 推送与持久化。
type EventSink interface {
    Token(text string)                    // 追加到 assistant message content
    Thought(text string)                  // 不进 content，仅调试事件
    ToolStart(name, detail string)
    ToolDone(name, detail string)
    Plan(entries []PlanEntry)
    Permission(decision PermissionDecision)
    Warning(code, message string)
    Debug(step, phase, message string, payload map[string]any)
}

type PromptRequest struct {
    SessionID   string                          // llmwiki ingest session id
    Mode        string                          // ingest|qa|organize
    DocLang     string                          // zh|en
    UserContent string                          // 已注入 wiki refs 的文本
    History     []sqlite.IngestSessionMessage    // native 需要；ACP 仅首轮引导使用
}

type PromptResult struct {
    Text       string // 最终 assistant 正文
    StopReason string // end_turn|max_tokens|max_turn_requests|refusal|cancelled|tool_loop_failed
}

type Runtime interface {
    Kind() string
    Label() string // UI 显示用，如 "native / deepseek-chat" 或 "acp / my-agent"
    Prompt(ctx context.Context, req PromptRequest, sink EventSink) (PromptResult, error)
}
```

`agentruntime.Resolve(db *sqlite.DB, workspace string, mgr *acp.Manager, session *sqlite.IngestSession) (Runtime, error)`：

- `session.AgentKind == "acp"` → 读 `acp_agents_json`，找 `session.ACPAgentID` 对应且 `enabled` 的 agent，返回 `newACPRuntime(mgr, workspace, agentCfg)`。
- 否则（含空值）→ 复用现有 native 逻辑，返回 `newNativeRuntime(db, workspace, session)`。

**理由**：`internal/api/ingest_session.go` 的 `streamAssistantReply` 从"直接调 llm + tool loop"变成"调 `Runtime.Prompt` + 把事件转成 SSE 和 DB 写入"。ACP 的 JSON-RPC、进程、权限概念一个都不出现在 `internal/api` 与 `internal/ingest`。native 实现内部继续调 `ingest.RunSessionChatToolLoop` 与 `client.StreamChat` fallback，语义不变。

**导入方向**：`agentruntime` → `{acp, ingest, llm, mcp, sqlite}`；`api` → `agentruntime`。`ingest` 不 import `agentruntime`，无环。

### D3: ACP agent 配置 = `app_config.acp_agents_json`

```json
{
  "version": 1,
  "agents": {
    "my-agent": {
      "id": "my-agent",
      "name": "My Coding Agent",
      "enabled": true,
      "command": "npx",
      "args": ["-y", "some-acp-adapter", "--acp"],
      "env_passthrough": ["PATH", "HOME", "LANG", "SOME_PROVIDER_API_KEY"],
      "cwd_policy": "workspace",
      "init_timeout_ms": 30000,
      "prompt_timeout_ms": 600000,
      "idle_timeout_ms": 120000,
      "permission": {
        "mode": "auto",
        "allow_read": true,
        "allow_search": true,
        "allow_fetch": false,
        "allow_write": false,
        "allow_execute": false
      }
    }
  },
  "defaults": {
    "readonly_only": true,
    "on_unavailable": "error"
  }
}
```

字段语义：

| 字段 | 默认 | 说明 |
|------|------|------|
| `command` | 无（必填） | 可执行文件名或绝对路径，经 `exec.LookPath` 解析；不接受 shell 元字符 |
| `args` | `[]` | 启动参数；不得夹带凭据，校验命中即整份配置失败（见 D4） |
| `env_passthrough` | `["PATH","HOME","LANG"]` | **只声明变量名**，值始终来自 llmwiki 进程环境，未设置则跳过；这是配置里唯一的凭据通道 |
| `cwd_policy` | `workspace` | `workspace` \| `session` |
| `init_timeout_ms` | 30000 | `initialize` + `session/new` 合计上限，范围 1000–120000 |
| `prompt_timeout_ms` | 600000 | 单 turn 上限，范围 5000–3600000 |
| `idle_timeout_ms` | 120000 | 无 `session/update` 的静默上限，范围 5000–600000 |
| `permission.mode` | `auto` | 仅 `auto`（非交互）；预留 `ask` 但 v1 校验拒绝 |
| `defaults.readonly_only` | `true` | 全局硬闸：为 true 时 write/execute 一律拒绝，覆盖 per-agent 开关 |
| `defaults.on_unavailable` | `error` | 仅 `error`；不允许静默降级到 native |

**没有 `env` 字段**：配置模型里不存在任何能放下一个环境变量值的字段。这一条是 D4 凭据边界的结构性前提，不是可选风格。

**理由**：

- 完全通用。任何 ACP agent 都是"一个命令 + 参数 + 环境变量名 + 工作目录 + 权限"，不需要 `type: "cursor"|"codex"|"pi"` 这种枚举。
- `enabled` / `id` 与 map key 一致的校验、JSON path 错误、`CanonicalJSON` 规范化落库，都与 `mcp_servers_json` 一致，前端 JSON 编辑器交互可直接照抄 MCP 卡片。
- `defaults.readonly_only` 与 `defaults.on_unavailable` 是"运维闸门"，与 per-agent 的"能力声明"分层，避免单个 agent 配置越权。

### D4: 凭据边界 = 配置只出现变量名，值只在进程环境

**选择**：

- 配置里**不存在**任何存放环境变量值的字段。唯一的凭据通道是 `env_passthrough`：只声明变量名，值始终在 llmwiki 进程环境里，配置文件与数据库都不经手。
- `env_passthrough` 的每一项做**名称格式白名单**校验：必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，空串与重复项报错，path 为 `agents.<id>.env_passthrough[<i>]`。**不因名称含 `KEY` / `TOKEN` / `SECRET` 等子串而拒绝**——透传凭据正是这个字段存在的理由，在这里拒绝只会把用户逼回 `args` 夹带，反而更危险。
- `command` 必须是可执行名或绝对路径，不含 `;` `|` `&` `` ` `` `$` `<` `>` `(` `)` 与换行等 shell 元字符（系统不经 shell 启动进程，接受这些字符只会让用户误以为支持 shell 语法）。
- `args` 做**凭据夹带校验**，命中即整份配置校验失败，path 精确到 `agents.<id>.args[<i>]`：
  - 参数名（大小写不敏感，同时匹配 `--k v` 与 `--k=v` 两种形式）：`--token`、`--api-key`、`--api_key`、`--password`、`--secret`、`--authorization`、`--header`
  - 参数值形态：`Bearer ` 前缀、`Authorization:` 前缀，以及常见 token 前缀 `sk-`、`ghp_`、`github_pat_`、`xoxb-`、`xoxp-`、`AKIA`，以及 JWT 形态（`eyJ` 开头且含两个 `.`）
  - 错误信息固定指引：「命令参数不得携带凭据，请用 `env_passthrough` 声明变量名，并把值放进 llmwiki 进程环境」
  - 这是**显式安全校验，不做"自动脱敏后继续执行"**：脱敏会让用户以为密钥已经传进去了，实际 agent 拿不到，制造更难排查的鉴权故障。
- 已移除的 `env` 字段被**明确拒绝**而非静默丢弃：`ParseConfig` 在某个 agent 对象里发现 `env` 键时返回 `ve("agents.<id>.env", "配置不接受环境变量值，请用 env_passthrough 只声明变量名")`。静默丢弃等于让用户写下的密钥凭空消失又不报错，是最坏的一种失败模式。
- 响应侧：`GET /api/v1/acp-agents` 与 `POST /api/v1/acp-agents/check` 里 `env_passthrough` 只回**变量名 + 该名字在当前进程环境是否已设置**（`{"name":"SOME_PROVIDER_API_KEY","present":true}`），永不回值。
- `GET /api/v1/settings` 返回的 `acp_agents_json` 是 `CanonicalJSON` 结果——由于配置本身不含任何环境值，这里无需二次掩码；`maskKey`（`internal/api/settings.go:18`）不适用。
- 子进程 env 构造为**白名单**：只有 `env_passthrough` 中在当前进程环境已存在的变量 + `PATH`（强制保留，否则 `exec.LookPath` 后的启动器无法解析子命令）。llmwiki 进程的其他环境变量一律不透传给 agent。
- 落 `session_message_events` 的所有 JSON-RPC payload 先过 `ingest.SanitizePayload`；agent stderr 先过 `acp.SanitizeText`（正则掩码 `sk-[A-Za-z0-9_\-]{8,}`、`Bearer\s+\S+`、`ghp_\w+`、`xox[baprs]-\S+`，替换为 `***`），再按 4KB 截断。

**理由**：把凭据留在进程环境是唯一"配置文件与数据库都不含密钥"的方案；`llmwiki-data` 工作区会被 `workspace-backup-track` 提交，配置里出现密钥就等于提交密钥。所以边界必须是结构性的（字段不存在），而不是靠"校验器猜哪个值像密钥"。校验器的职责因此收窄成两件确定的事：把唯一正路（`env_passthrough`）的名字格式管住，把绕过正路的两条旁路（`command`、`args`）堵死。

**相关测试**：`internal/acp/config_test.go` 覆盖 `env_passthrough` 非法名称/空串/重复项被拒且 path 正确、含 `KEY`/`TOKEN` 的变量名**被接受**、出现 `env` 键被明确拒绝、`RedactedAgents` 不回任何环境值；`internal/acp/config_credentials_test.go` 表驱动覆盖 `args` 各类凭据形态逐一被拒且 path 为 `agents.<id>.args[<i>]`，以及 `--verbose`、`-y`、`some-acp-adapter` 这类正常参数不被误伤；`internal/acp/jsonrpc_test.go` 用 fake agent 回显收到的 env 名单，验证白名单生效且 llmwiki 进程的无关变量未透传。

### D5: 切换层级 = session 级为主，全局默认为辅

**选择**：

- **权威来源是 session**：`ingest_sessions.agent_kind` + `ingest_sessions.acp_agent_id`。每次 turn 由 `agentruntime.Resolve` 读 session 行决定 runtime，不看任何全局状态。
- **全局默认**：`app_config.default_agent_kind`（默认 `native`）+ `default_acp_agent_id`。`POST /api/v1/ingest/sessions` 未显式传时从这两个键填充；`PATCH /api/v1/ingest/sessions/{id}` 更新 runtime 时同步写回这两个键（"最近使用"语义，与现有 `last_instance_id` / `last_model` 的处理方式一致，见 `internal/api/ingest_session.go:1105`）。
- **切换时机限制**：session 有 `stream_status='streaming'` 的 assistant message 时拒绝切换（HTTP 409），复用 `sessionHasStreamingAssistant`。已 `archived` 的 session 拒绝切换（HTTP 409）。
- **中途切换允许**：一个 session 从 native 切到 ACP（或反向）不清空历史。native 侧历史照常进 prompt；ACP 侧首轮把 llmwiki 已有历史压成一段引导上下文（见 D8）。

**理由**：session 级是唯一能同时满足"不同话题用不同 agent"和"刷新后行为可复现"的层级。全局默认只影响"新建"，不追溯改写已有 session，避免用户改一次默认就让所有旧会话行为漂移。

### D6: native 路径的 provider/model 守卫保持不变，ACP 模式改走 runtime 就绪性

**选择**：

- 后端：`streamSessionReply` 与 `streamAssistantReply` 开头的 `a.sessionLLMClient(session)` 调用移到 native runtime 内部。`session.AgentKind == "acp"` 时**完全不触碰** `provider_instances`，不构造 `llm.Client`，不产生"请先选择 Provider 实例和 Model"错误。
- 后端 ACP 就绪性检查（按序，任一失败返回 400 并写 `activity.LogSession(..., "stream_error", ...)`）：配置可解析 → `acp_agent_id` 非空 → 该 agent 存在 → `enabled` → `exec.LookPath(command)` 成功。
- session 的 `llm_instance_id` / `llm_model` 在 ACP 模式下**保留不清空**，切回 native 时原样生效。
- 前端：`IngestChat` 的 `isReady` 拆成
  ```
  isReady = !!sessionId && (
      agentKind === "acp"
        ? !!selectedACPAgent && selectedACPAgent.enabled && selectedACPAgent.available
        : (!!effectiveInstanceId && !!effectiveModel)
  )
  ```
  ACP 未就绪的提示文案区分"未选 agent" / "agent 已禁用" / "CLI 未安装"。
- `ModelSelectDialog` 在 ACP 模式下把 instance / model 两个 `<select>` 置灰并显示"ACP 模式下由 agent 自行选择模型"，但**不隐藏**，保证切回 native 时可见可改。

**理由**：`model-selection-ui` 的"缺少 API Key → 禁用输入框"守卫在 ACP 下是错误信号（ACP agent 自带凭据）。把守卫条件参数化到 runtime 而不是删除，既修正 ACP 误禁用，又保留 native 的既有保护。

### D7: 事件映射与持久化 —— 复用现有真相源，不新建会话表

| ACP `session/update` | SSE 事件 | `ingest_session_messages` | `session_message_events` |
|---|---|---|---|
| `agent_message_chunk`（`content.type=text`） | `token` | 追加 `content`，节流 `UpdateIngestSessionMessageContent(id, buf, "streaming")` | — |
| `agent_message_chunk`（非 text） | `warning` code=`acp_unsupported_content` | — | `step=acp_turn` `phase=agent_message_unsupported` |
| `agent_thought_chunk` | `thought` | **不写** | `phase=agent_thought` |
| `user_message_chunk` | — | 忽略（llmwiki 侧已持久化 user message） | `phase=user_message_echo` |
| `tool_call` | `tool_start`（`{tool, detail}`，字段与 native 一致） | — | `phase=acp_tool_call` |
| `tool_call_update`（`status=completed\|failed`） | `tool_done` | — | `phase=acp_tool_call_update` |
| `tool_call_update`（其他 status） | — | — | `phase=acp_tool_call_update` |
| `plan` | `plan` | — | `phase=acp_plan` |
| `usage_update` | — | — | `phase=acp_usage` |
| `available_commands_update` / `current_mode_update` / 未知 | — | — | `phase=acp_update_ignored` |
| `session/request_permission` 决策 | `permission` | — | `phase=acp_permission` + `activity.Record(category:"agent")` |
| `session/prompt` 返回 `stopReason` | — | 见下 | `phase=acp_stop_reason` |

`stopReason` → `stream_status` 落库：

- `end_turn` / `max_tokens` / `max_turn_requests` → `complete`（正文为空时改 `failed`，与 native 的空响应处理一致）
- `cancelled` → `incomplete`
- `refusal` → `failed`，正文为空时写入拒绝说明

**SSE 事件新增的兼容性**：`AppContext.applyAssistantStreamEvent` 对未识别的 `event` 名不做任何处理，因此 `thought` / `plan` / `permission` 对旧前端是无害的。新前端把 `thought` 渲染成折叠区、`plan` 渲染成任务清单、`permission` 渲染成 `tool_status` 行内提示。

**刷新可见性**：正文来自 `ingest_session_messages`（`GET /messages` 已覆盖）；thought / tool / plan / permission 来自 `session_message_events`（`GET /messages/{messageId}/events` 已覆盖，`MessageDebugDialog` 已能展示）。零新建端点、零新建表。

**归档语义**：`ingest.BuildSessionArchiveMarkdown` 只读 `ingest_session_messages`，因此 ACP 的 thought / tool / plan **不进归档 markdown**。归档产物与 native 完全同构，review / plan / apply 链路无需改动。

### D8: 进程生命周期 —— 每 session 一进程，懒启动、可复用、无孤儿

**选择**：`internal/acp.Manager` 持有 `map[string]*Conn`（key 为 llmwiki session id）+ `sync.Mutex`。

- **懒启动**：首次 `Prompt` 时 spawn，做 `initialize` → 校验 `protocolVersion == 1`（不等则关闭并报错"agent 要求 protocolVersion=N，llmwiki 当前实现 1"）→ `session/new{cwd, mcpServers: []}` → 缓存 `Conn{cmd, remoteSessionID, agentInfo, stderrRing}`。
- **复用**：同 session 后续 turn 复用同一进程与同一 ACP `sessionId`，保留 agent 侧上下文。
- **并发**：同 session 串行（沿用现有 `sessionHasStreamingAssistant` → HTTP 409）。不同 session 并行，上限 `app_config.acp_max_concurrent_agents`（默认 4，范围 1–16）；超限返回 HTTP 503 + `Retry-After: 5`，不排队（避免 SSE 长时间挂住）。
- **进程与后代清理**：`SysProcAttr{Setpgid: true}`；终止统一为 `SIGTERM` → 3s → `SIGKILL`。这是必需的：`npx`/`node` 这类启动器会 fork 子进程，只杀首进程会留孤儿。Linux 额外在根进程仍可查询时递归快照 `/proc/<pid>/task/<pid>/children`，对后代逐个补发信号，并用 pidfd/starttime 防止 PID 复用误杀；`setsid` / 新建进程组 / 双重 fork 后的后代因此也能被清理。非 Linux 保持负 PGID 两阶段语义。
- **崩溃恢复**：stdout EOF 或进程退出 → 当前 turn `stream_status=failed`，把脱敏截断后的 stderr 尾部与 exit code 写 `phase=acp_process_exit`，SSE 发 `error`；从池中移除 `Conn`。同一 turn 内**最多自动重启 1 次**（仅当崩溃发生在收到任何 `agent_message_chunk` 之前，避免重复输出）；否则交给用户重试（现有 `POST /messages/{messageId}/retry` 已支持）。
- **超时**：`init_timeout_ms` 覆盖 initialize+session/new；`prompt_timeout_ms` 覆盖单 turn；`idle_timeout_ms` 由"最近一次 `session/update` 时间"驱动的 timer 判定。任一超时先走取消序列，再按崩溃路径清理。
- **取消**：HTTP request context 取消（用户点 Stop → `AbortController`）→ 发 `session/cancel` notification → 等 `session/prompt` 返回 `cancelled`，上限 5s → 超时则终止进程组。期间继续接收并持久化 `session/update`（协议要求 client 在 cancel 后仍接受 tool call 更新）。
- **清理**：`DeleteIngestSessionHandler` 与 `ArchiveIngestSession` 成功后调 `mgr.CloseSession(id)`；`server.Shutdown` 调 `mgr.CloseAll()`（在 `s.http.Shutdown` 之后、返回之前）。`cmd/llmwiki/serve.go` 构造 `mgr` 并注入 `server.Config`。
- **进程重启后的历史**：不用 `session/resume`（依赖 `loadSession` capability，通用性差）。重新 `session/new` 后，首个 `session/prompt` 的 `prompt` 数组前置一个 `text` block，内容是 llmwiki 侧历史的压缩摘要（复用 `ingest.AssembleIngestChatMessages` 产出的消息序列，渲染为 `## User` / `## Assistant` 段落，按 `truncateMessages` 同样的 48 条上限），后接本轮真实用户输入。agent 声明 `agentCapabilities.loadSession=true` 时的 `session/load` 优化留作后续。

**理由**：per-session 进程是让 agent 侧上下文与 llmwiki 会话边界对齐的最简模型；共享单进程会让不同 session 的上下文互相污染，per-turn 进程会让每轮都丢上下文且启动开销（`npx` 冷启动数秒）不可接受。

### D9: 权限模型 —— 非交互、默认拒绝、kind 白名单

`clientCapabilities` 固定为：

```json
{ "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false }
```

即 llmwiki **不实现** `fs/*` 与 `terminal/*`。agent 若要读写文件只能用自己的实现，作用范围受 `cwd` 约束；这同时消掉了"agent 通过 client 方法读 workspace 外文件"的整条攻击面。

`session/request_permission` 决策矩阵（`acp.Decide`）：

| `toolCall.kind` | 需要的开关 | 允许时选项 | 拒绝时选项 |
|---|---|---|---|
| `read` | `permission.allow_read` | `allow_once` | `reject_once` |
| `search` | `permission.allow_search` | `allow_once` | `reject_once` |
| `think` | 恒允许 | `allow_once` | — |
| `fetch` | `permission.allow_fetch` | `allow_once` | `reject_once` |
| `edit` / `delete` / `move` | `permission.allow_write` **且** `!defaults.readonly_only` | `allow_once` | `reject_once` |
| `execute` | `permission.allow_execute` **且** `!defaults.readonly_only` | `allow_once` | `reject_once` |
| `other` / 未知 / `kind` 缺失 | —（默认拒绝） | — | `reject_once` |

选项选择规则：

- **永不选 `allow_always` / `reject_always`**。这两个 kind 会让 agent 端记住决定，绕过后续策略评估；每次都用 `_once` 保证策略是唯一权威。
- 目标 kind 在 `options` 中不存在 → 回 `{"outcome":{"outcome":"cancelled"}}`，并记 `phase=acp_permission` + `reason=no_matching_option`。
- turn 已被取消 → 所有 pending 请求回 `cancelled`（协议强制要求）。

工作目录隔离（`acp.ResolveCWD`）：

- `cwd_policy: "workspace"` → workspace 根绝对路径。
- `cwd_policy: "session"` → `<workspace>/.llmwiki/cache/acp/sessions/<sessionID>`，`MkdirAll 0o700`。选 `.llmwiki/cache/` 是因为 `vcs.FineGrainedGitignoreEntries` 已包含 `.llmwiki/cache/`，沙箱内容天然不会被 `workspace-backup-track` 提交。
- 越界防护：`filepath.Abs` → `filepath.EvalSymlinks`（workspace 与目标各求一次）→ 要求目标等于 workspace 或以 `workspace + string(os.PathSeparator)` 开头。不满足则拒绝启动。EvalSymlinks 是必需的：单纯前缀比较可被 workspace 内的符号链接绕过。

**理由**：默认只读 + 默认拒绝未知 kind 是唯一能在"agent 能力不可预知"的前提下保持安全的姿态。用户要放开 write/execute 需要同时改 per-agent 开关和 `defaults.readonly_only`，双确认。

### D10: 可用性探测与"CLI 不存在"的处理

`POST /api/v1/acp-agents/check`（可选 body `{"acp_agents_json": "..."}` 探测未保存配置，与 `CheckMCPStatus` 一致）对每个 agent：

1. `enabled=false` → `status: "disabled"`。
2. `exec.LookPath(command)` 失败 → `status: "error"`，`message: "命令 <command> 未找到（PATH 中不可用）"`，`code: "cli_not_found"`。
3. spawn → `initialize`，超时 `min(init_timeout_ms, 15000)` → 成功则 `status: "ok"` 并返回 `agent_name` / `agent_version` / `protocol_version` / `agent_capabilities` 摘要；随后立即终止探测进程（不复用到会话池）。
4. 版本不匹配 → `status: "error"`，`code: "protocol_version_unsupported"`。

`GET /api/v1/acp-agents` 是轻量版：只做 1、2 两步（`exec.LookPath`，不 spawn），返回 `available` 布尔与 `unavailable_reason`。前端页面加载时用它，用户点"检查连接"时用 `check`。

**不静默降级**：`defaults.on_unavailable` 只接受 `error`。ACP 模式下 agent 不可用时明确报错并禁用输入框，绝不悄悄回退 native——否则用户会以为在用 ACP agent，实际拿到的是 native 输出。

`GET /api/v1/health` 的 `mode` 增加 `"acp_enabled": <配置中存在至少一个 enabled agent>`，作为部署后可 curl 的最小验证信号。

### D11: 数据库迁移与向后兼容

`internal/store/sqlite/migrate_session_agent_runtime.go`：

```go
func (d *DB) migrateSessionAgentRuntime() error // 幂等
```

- 用 `SELECT COUNT(*) > 0 FROM pragma_table_info('ingest_sessions') WHERE name = 'agent_kind'` 探测（照抄 `MigrateAddSessionMode`）。
- 缺列则：
  - `ALTER TABLE ingest_sessions ADD COLUMN agent_kind TEXT NOT NULL DEFAULT 'native' CHECK(agent_kind IN ('native','acp'))`
  - `ALTER TABLE ingest_sessions ADD COLUMN acp_agent_id TEXT NOT NULL DEFAULT ''`
- 接入 `DB.Migrate()`，插在 `MigrateAddSessionMode` 之后、`migrateSessionMessageEvents` 之前。
- `schema.sql` 的 `CREATE TABLE ingest_sessions` 同步加这两列（新库直接正确，老库靠迁移）。

兼容性保证：

- 现有行 `agent_kind='native'`、`acp_agent_id=''`，`Resolve` 走 native，行为与今天逐字节一致。
- `app_config` 里 `default_agent_kind` 缺失时读到空串，`Resolve` 与 `CreateIngestSession` 都把空串当 `native`。
- `acp_agents_json` 缺失时 `acp.ParseConfig("")` 返回 `DefaultConfig()`（空 `agents` map），`GET /api/v1/acp-agents` 返回空数组，不报错。
- 不要求重新 `llmwiki init`，不要求 `reindex`（`ingest_sessions` 不参与 reindex 重建）。
- `provider_keys` / `provider_instances` / `llm_instance_id` / `llm_model` 全部不动。

### D12: 只改 session chat，不改 job pipeline

`internal/ingest/pipeline.go`、`processor.go`、`review_processor.go`、`pipeline_tool_executor.go` 一行不改。理由：

- job 侧是无人值守批处理（`ingest.NewJobProcessor` 每 2s 轮询），把不确定时长、不确定权限的外部 agent 塞进队列会让 `idx_ingest_one_running` 这类并发约束和重试语义变得不可推理。
- 归档产物（archive markdown）在 D7 下与 native 同构，因此 ACP session 归档后的 review / plan / apply 全链路自动可用，无需 job 侧感知 ACP。

## Risks / Trade-offs

- **[外部 agent 行为不可控]** ACP agent 可能长时间静默、输出巨量 chunk、或请求未知权限 → `idle_timeout_ms` + `prompt_timeout_ms` 兜时长；`ingest.SanitizePayload` 的 32KB 截断 + `session_message_events` 的 per-message 保留上限（`GetSessionMsgEventsMaxCount`，默认 100）兜存储；未知 `kind` 默认拒绝兜权限。
- **[凭据依赖部署方正确注入进程环境]** `env_passthrough` 只声明名字，值存不存在由部署方保证 → 名字在进程环境缺失时 llmwiki 直接跳过该变量，agent 自己报鉴权失败，错误现场离根因较远；缓解是 `{name, present}` 里的 `present=false` 在 Settings 卡片显性暴露，llmwiki 侧不猜测、不补值、不从配置读值。
- **[args 凭据校验是模式匹配，可被绕过]** 用户仍可以用未覆盖的参数名或自定义 token 形态把密钥塞进 `args` → 接受：该校验的目标是挡住常见误用并把人导向正确做法，不是做完备的密钥检测；真正的保证来自"配置里没有任何字段是为放密钥而设计的"以及 `env_passthrough` 这条更省事的正路。相应地，误伤风险也要控住：只匹配明确的凭据参数名与 token 前缀，不做通用高熵字符串检测。
- **[进程孤儿与资源泄漏]** `npx` 类启动器 fork 子进程，且可能 `setsid` 逃出进程组 → Linux 用 `/proc` 后代快照 + pidfd（或 starttime 校验回退）覆盖，非 Linux 用负 pgid + `CloseAll` 兜底。仍存在 llmwiki 自身被 `SIGKILL` 时来不及清理、以及根进程在两次快照之间被 reparent 的极小窗口，接受（单用户本机场景，容器重启即清）。
- **[agent 侧历史与 llmwiki 历史不一致]** 进程重启后 agent 上下文清零，靠压缩历史重建，语义有损（工具调用细节丢失）→ 接受；在 `session_message_events` 记 `phase=acp_history_replay` 让用户可诊断。
- **[协议版本漂移]** ACP v2 已在演进（`state_update`、`session/set_config_option`、移除 `fs/*` 与 `terminal/*`）→ 本变更只声明 `protocolVersion: 1` 并在不匹配时明确报错而非猜测降级；`internal/acp/events.go` 的解码全部走 `switch ... default: 忽略并记事件`，为 v1 内的新 `sessionUpdate` 变体留兼容余地。
- **[写权限打开后的破坏面]** 用户若同时关掉 `readonly_only` 并开 `allow_write`，agent 可在 workspace 内任意改文件，绕过 `internal/api/filewrite.go` 的 file-first 写入与 `PageLockManager` → 接受但显式：默认关闭、需双开关、每次决策入 `activity_logs`（category `agent`），且 `wiki/` 变更仍会被 watcher 与 `workspace-backup-track` 捕获，可 git 回滚。
- **[镜像体积 vs 可用性]** 装 ACP CLI 需要 Node 运行时，默认镜像会从 186MB 涨到 400MB+ → 拆成两个镜像 tag，默认部署不受影响，代价是运维需要维护两条构建线。
- **[前端 SSE 词表扩张]** 新增 3 个事件 → 旧前端忽略未知事件，向后兼容；代价是前端需要为 ACP 单独实现 thought / plan 渲染，`MessageBubble` 复杂度上升。
- **[双 runtime 的测试面翻倍]** native 与 ACP 两条路径都要覆盖 → 用 `agentruntime.Runtime` 接口做测试接缝，`internal/api` 的 handler 测试注入 fake runtime，不需要真起子进程；`internal/acp` 用一个 Go 写的 fake ACP agent 二进制（testdata，`go test` 内 `go build` 到临时目录）做端到端。

## Migration Plan

1. **schema 与迁移先行**：`schema.sql` 加列 + `migrateSessionAgentRuntime` 接入 `Migrate()`。此步单独可验收：老 db 打开后 `pragma_table_info` 有新列且所有行 `agent_kind='native'`，`make test` 全绿，UI 行为零变化。
2. **接缝落地、行为不变**：引入 `internal/agentruntime` 与 native 实现，把 `streamAssistantReply` 改为经 `Runtime.Prompt`。此步的验收标准是"现有 `internal/api/ingest_session_test.go` 与 `web/src/ingest-chat.test.tsx` 不改断言即通过"——即纯重构，无行为变化。
3. **ACP 客户端独立开发**：`internal/acp` 全部子模块 + fake agent 端到端测试。此步不接入 API，可独立验收。
4. **配置与只读 API**：`acp_agents_json` 校验（含 `env_passthrough` 名称校验与 `command`/`args` 凭据校验）、`GET /api/v1/acp-agents`、`POST /api/v1/acp-agents/check`、Settings 三个键。此步后用户能配置和探活，但还不能对话。
5. **接通 ACP runtime**：`agentruntime.Resolve` 支持 ACP、`Manager` 注入 `serve`、session 字段读写、SSE 新事件。
6. **前端**：类型 → API → Context → UI，最后接 i18n。
7. **文档与部署**：README、`docs/16-acp-agent-runtime.md`、lnv 可选镜像变体说明与验证清单。

回滚路径：把 `default_agent_kind` 置回 `native` 并把所有 session 的 `agent_kind` 置回 `native`（一条 SQL），ACP 代码路径即完全不被触达；新增的两列留着无副作用。

## Open Questions

1. **lnv 是否需要 `lwiki-acp` 镜像变体，装哪个 ACP CLI？** 默认按"不出变体、ACP 仅本机开发可用"实施（镜像与 compose 零改动，任务 14 只写文档与验证清单，不改构建）。若需要在 lnv 上真的跑 ACP，需要人工拍板装哪个 adapter、接受的镜像体积上限、以及凭据放 `~/.agent-deploy/lnv/llmwiki/.env.acp`（600，不入库，经 compose `env_file` 注入 llmwiki 进程环境）是否符合当前运维约定。
2. **是否需要交互式权限审批（human-in-the-loop）？** 默认按 `permission.mode = "auto"` 非交互实施，`ask` 模式在校验层直接拒绝。若要交互，需要新增"暂停 turn 等前端响应"的 SSE 往返（SSE 是单向的，需要额外 `POST /messages/{id}/permission` 端点 + 前端对话框 + 超时默认拒绝），属于独立的后续 change。
3. **`readonly_only=false` 时是否要求 workspace 已启用 git？** 默认不强制（只在 Settings 卡片显示告警文案）。若希望"没有 git 就不许开写权限"，需要人工确认这个硬约束，实现上是在 `ValidateConfig` 之外加一个依赖 `vcs.NewGitRepo(workspace).IsInitialized()` 的运行时闸门。
