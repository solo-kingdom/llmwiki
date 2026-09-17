# Tasks

约定：每个小节可独立验收。Go 侧每节结束跑 `make test`；前端侧每节结束跑 `cd web && npm test`。

## 1. 数据库 Schema 与迁移

- [x] 1.1 在 `internal/store/sqlite/schema.sql` 的 `CREATE TABLE IF NOT EXISTS ingest_sessions` 中，于 `mode` 之后新增 `agent_kind TEXT NOT NULL DEFAULT 'native' CHECK (agent_kind IN ('native', 'acp'))` 与 `acp_agent_id TEXT NOT NULL DEFAULT ''`
- [x] 1.2 新建 `internal/store/sqlite/migrate_session_agent_runtime.go`，实现幂等方法 `func (d *DB) migrateSessionAgentRuntime() error`：以 `SELECT COUNT(*) > 0 FROM pragma_table_info('ingest_sessions') WHERE name = 'agent_kind'` 探测，缺列时分两条 `ALTER TABLE ... ADD COLUMN`（写法参照 `MigrateAddSessionMode`）
- [x] 1.3 在 `internal/store/sqlite/db.go` 的 `Migrate()` 中，于 `MigrateAddSessionMode(d)` 之后、`d.migrateSessionMessageEvents()` 之前调用 `d.migrateSessionAgentRuntime()`
- [x] 1.4 在 `internal/store/sqlite/ingest_sessions.go` 的 `IngestSession` 结构体新增 `AgentKind string \`json:"agent_kind"\`` 与 `ACPAgentID string \`json:"acp_agent_id"\``
- [x] 1.5 更新 `scanIngestSession` 的扫描顺序，并同步 `CreateIngestSession`、`GetIngestSession`、`ListIngestSessions` 三处 SQL 的列清单（含 `COALESCE(agent_kind,'native')`、`COALESCE(acp_agent_id,'')`）与 INSERT 参数
- [x] 1.6 新增 `func (d *DB) UpdateIngestSessionAgent(id, agentKind, acpAgentID string) error`，更新两列并刷新 `updated_at`
- [x] 1.7 在 `internal/store/sqlite/ingest_sessions_test.go`（不存在则新建）覆盖：新库建表含两列、老库（先建不含两列的表再跑迁移）迁移后现有行为 `native`/空串、重复调用迁移幂等、`UpdateIngestSessionAgent` 往返、`CHECK` 拒绝非法 `agent_kind`

## 2. ACP 配置模型（`internal/acp/config.go`）

- [x] 2.1 新建 `internal/acp/config.go`，定义 `Config{Version int; Agents map[string]AgentConfig; Defaults Defaults}`、`AgentConfig{ID,Name string; Enabled bool; Command string; Args []string; EnvPassthrough []string; CWDPolicy string; InitTimeoutMS,PromptTimeoutMS,IdleTimeoutMS int; Permission PermissionPolicy}`、`PermissionPolicy{Mode string; AllowRead,AllowSearch,AllowFetch,AllowWrite,AllowExecute bool}`、`Defaults{ReadonlyOnly bool; OnUnavailable string}`；**不得定义任何存放环境变量值的字段**（无 `Env map[string]string`），凭据通道只有 `EnvPassthrough` 的变量名
- [x] 2.2 定义常量：`ConfigVersion = 1`、`DefaultCWDPolicy = "workspace"`、`DefaultInitTimeoutMS = 30000`、`DefaultPromptTimeoutMS = 600000`、`DefaultIdleTimeoutMS = 120000`、`DefaultReadonlyOnly = true`、`DefaultOnUnavailable = "error"`、`DefaultMaxConcurrentAgents = 4`，以及各字段的 Min/Max 边界常量
- [x] 2.3 实现 `ValidationError{Path, Message string}` 与 `ve(path, msg)` 辅助（形态对齐 `internal/mcp/config.go`）
- [x] 2.4 实现 `DefaultConfig() *Config`（`agents` 为空 map，`defaults` 取默认值）
- [x] 2.5 实现 `ParseConfig(raw string) (*Config, error)`：空串返回 `DefaultConfig()`；`agents` 只接受对象（key 为 agent id），数组形态报明确错误；解析后调 `ValidateConfig` 再 `ApplyDefaultsAfterParse`
- [x] 2.6 实现 `ValidateConfig(cfg *Config) error` 的基础校验，覆盖：`version` 必须为 1；`agents` 的 key 非空且与 `id` 一致；`name` 必填；`command` 必填且为可执行名或绝对路径，不含 `;`、`|`、`&`、`` ` ``、`$`、`<`、`>`、`(`、`)`、换行等 shell 元字符（错误信息说明系统不经 shell 启动进程）；`cwd_policy ∈ {workspace, session}`；三个超时在边界内；`permission.mode` 必须为 `auto`；`defaults.readonly_only` 为 true 时 `allow_write`/`allow_execute` 为 true 需报错提示"需同时关闭 defaults.readonly_only"；`defaults.on_unavailable` 必须为 `error`
- [x] 2.7 实现 `env_passthrough` 名称校验：每一项必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，空串与同 agent 内的重复项报错，path 为 `agents.<id>.env_passthrough[<i>]`；**不得因名称含 `KEY`/`TOKEN`/`SECRET`/`PASSWORD` 等子串而拒绝**——透传凭据变量正是该字段的正当用途
- [x] 2.8 实现 `args` 凭据夹带校验 `validateArgsNoCredentials(id string, args []string) error`：逐项检查，命中即返回 `ve("agents.<id>.args[<i>]", "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境")`。命中规则为（a）凭据参数名，大小写不敏感且同时匹配 `--k v` 与 `--k=v`：`--token`、`--api-key`、`--api_key`、`--password`、`--secret`、`--authorization`、`--header`；（b）凭据值形态：`Bearer ` 前缀、`Authorization:` 前缀、`sk-`、`ghp_`、`github_pat_`、`xoxb-`、`xoxp-`、`AKIA`，以及 JWT 形态（`eyJ` 开头且含两个 `.`）。**只做显式拒绝，不做自动脱敏后继续执行**
- [x] 2.9 实现对已移除 `env` 字段的显式拒绝：`ParseConfig` 先以 `map[string]json.RawMessage` 解析每个 agent 对象，发现 `env` 键时返回 `ve("agents.<id>.env", "配置不接受环境变量值，请用 env_passthrough 只声明变量名")`；**不得静默丢弃**，避免用户以为写入的密钥已生效
- [x] 2.10 实现 `ApplyDefaultsAfterParse(cfg *Config)`：填 `cwd_policy`、三个超时、`env_passthrough` 缺省为 `["PATH","HOME","LANG"]`、`defaults` 缺省值
- [x] 2.11 实现 `CanonicalJSON(cfg *Config) (string, error)`（`MarshalIndent` 两空格，落库前规范化）
- [x] 2.12 实现 `func (c *Config) Agent(id string) (AgentConfig, bool)` 与 `func (c *Config) HasEnabledAgent() bool`
- [x] 2.13 实现 `RedactedAgents(cfg *Config) []RedactedAgent`：返回 `id/name/enabled/command/args/cwd_policy/permission/timeouts` 与 `env_passthrough: []EnvVarStatus{Name string; Present bool}`（`Present` 由 `os.LookupEnv` 得出），**不含任何环境变量值**
- [x] 2.14 新建 `internal/acp/config_test.go`，覆盖：空串默认配置、id 与 key 不一致报错且 path 正确、`command` 含 shell 元字符被拒、超时越界被拒、`mode: "ask"` 被拒、`readonly_only=true` 且 `allow_write=true` 被拒、`RedactedAgents` 不泄漏任何环境变量值、`CanonicalJSON` 幂等
- [x] 2.15 新建 `internal/acp/config_credentials_test.go` 专测凭据边界：`env_passthrough` 含 `1BAD`/空串/重复项被拒且 path 为 `agents.x.env_passthrough[<i>]`；`env_passthrough: ["SOME_PROVIDER_API_KEY","GITHUB_TOKEN"]` **被接受**；表驱动覆盖 `args` 各凭据形态（`--token`、`--api-key=sk-xxxxxxxx`、`Bearer abc`、`Authorization: x`、`ghp_*`、`github_pat_*`、`xoxb-*`、`xoxp-*`、`AKIA*`、`eyJ*.*.*`）逐一被拒且 path 为 `agents.x.args[<i>]`；`["-y","some-acp-adapter","--acp","--verbose"]` 不被误伤；配置出现 `env` 键返回 400 级校验错误且 path 为 `agents.x.env`

## 3. cwd 解析与越界防护（`internal/acp/cwd.go`）

- [x] 3.1 新建 `internal/acp/cwd.go`，实现 `ResolveCWD(workspace, sessionID, policy string) (string, error)`：`workspace` 策略返回 workspace 绝对路径；`session` 策略返回 `<workspace>/.llmwiki/cache/acp/sessions/<sessionID>` 并 `os.MkdirAll(dir, 0o700)`
- [x] 3.2 实现 `assertWithinWorkspace(workspace, target string) error`：两侧各做 `filepath.Abs` + `filepath.EvalSymlinks`，要求 target 等于 workspace 或以 `workspace + string(os.PathSeparator)` 为前缀，否则返回明确的越界错误
- [x] 3.3 新建 `internal/acp/cwd_test.go`，覆盖：`workspace` 策略返回绝对路径；`session` 策略创建目录且权限为 `0700`；sessionID 含 `../` 时被拒；workspace 内符号链接指向外部目录时 `assertWithinWorkspace` 返回错误；空 workspace 返回错误

## 4. JSON-RPC over stdio 与进程管理（`internal/acp/jsonrpc.go`、`process.go`）

- [x] 4.1 新建 `internal/acp/jsonrpc.go`，定义 `rpcRequest{JSONRPC,Method string; ID any; Params json.RawMessage}`、`rpcResponse{JSONRPC string; ID any; Result json.RawMessage; Error *rpcError}`、`rpcError{Code int; Message string; Data json.RawMessage}`
- [x] 4.2 实现 `conn` 类型：`bufio.Scanner` 读 stdout（`Buffer` 设为 1MB 上限，与 `internal/llm/client.go` 的 SSE 读法一致），单 goroutine 分发；出站请求用自增 int64 id + `map[int64]chan rpcResponse` 关联；写操作用 `sync.Mutex` 串行化
- [x] 4.3 实现入站分派：`session/update` 与其他 notification（无 `id`）交给注册的 `NotificationHandler`；`session/request_permission` 等 request（有 `id`）交给 `RequestHandler` 并把返回值写回 stdout；未知方法返回 JSON-RPC `-32601`
- [x] 4.4 实现 `func (c *conn) Call(ctx context.Context, method string, params any, out any) error`：ctx 取消时从关联表移除并返回 `ctx.Err()`；stdout 关闭时所有 pending 调用收到 EOF 错误
- [x] 4.5 实现 `func (c *conn) Notify(method string, params any) error`
- [x] 4.6 新建 `internal/acp/process.go`，实现 `spawn(ctx context.Context, cfg AgentConfig, cwd string) (*process, error)`：`exec.LookPath(cfg.Command)` 失败时返回 `ErrCLINotFound` 包装错误；`exec.Command` + `SysProcAttr{Setpgid: true}`；`Dir = cwd`
- [x] 4.7 在 `spawn` 中构造白名单 env：仅 `cfg.EnvPassthrough` 中经 `os.LookupEnv` 命中的变量，并强制保留 `PATH`；llmwiki 进程的其余环境变量一律不透传，也不存在任何来自配置的字面量环境值
- [x] 4.8 实现 stderr ring buffer：goroutine 读 stderr，保留尾部 4KB（`acp.SanitizeText` 处理后），提供 `func (p *process) StderrTail() string`
- [x] 4.9 实现 `func (p *process) Terminate()`：`syscall.Kill(-pgid, syscall.SIGTERM)` → 等 3s → `syscall.Kill(-pgid, syscall.SIGKILL)` → `cmd.Wait()`；重复调用安全（`sync.Once`）
- [x] 4.10 新建 `internal/acp/sanitize.go`，实现 `SanitizeText(s string) string`：正则替换 `sk-[A-Za-z0-9_\-]{8,}`、`(?i)bearer\s+\S+`、`gh[pousr]_[A-Za-z0-9]{16,}`、`xox[baprs]-\S+` 为 `***`
- [x] 4.11 新建 `internal/acp/sanitize_test.go`，覆盖各正则命中与不误伤普通文本（如 `sk-` 后不足 8 位、单词 `bearer` 单独出现）
- [x] 4.12 新建 `internal/acp/testdata/fakeagent/main.go`：一个用 stdlib 实现的最小 ACP agent，支持 `initialize`、`session/new`、`session/prompt`（按环境变量脚本化行为：正常回复 / 发 thought / 发 tool_call / 请求 permission / 挂住不响应 / 立即崩溃 / 返回不支持的 protocolVersion）、`session/cancel`；并支持把自己收到的环境变量**名单**（只回名字，不回值）回显给 client 用于白名单断言
- [x] 4.13 新建 `internal/acp/jsonrpc_test.go`，用 fake agent 覆盖：请求响应关联、notification 分派、入站 request 应答、ctx 取消、stdout EOF 时 pending 调用出错、`Terminate` 杀掉整个进程组，以及 env 白名单：`env_passthrough` 命中的变量到达子进程、`PATH` 始终存在、llmwiki 进程中一个未声明的变量**未**到达子进程

## 5. ACP client 与事件解码（`internal/acp/client.go`、`events.go`）

- [x] 5.1 新建 `internal/acp/events.go`，定义中性事件类型 `Event{Kind string; Text string; ToolCallID,ToolName,ToolKind,ToolStatus,ToolTitle string; ToolRawInput,ToolRawOutput json.RawMessage; Plan []PlanEntry; Raw map[string]any}`，`Kind` 取值 `message|thought|tool_call|tool_call_update|plan|usage|user_echo|ignored`
- [x] 5.2 实现 `DecodeSessionUpdate(raw json.RawMessage) (Event, error)`：按 `update.sessionUpdate` 分派 `agent_message_chunk`/`agent_thought_chunk`/`user_message_chunk`/`tool_call`/`tool_call_update`/`plan`/`usage_update`，`default` 返回 `Kind: "ignored"` 而非报错
- [x] 5.3 在 `DecodeSessionUpdate` 中处理 `ContentBlock`：只把 `type: "text"` 提取为 `Text`；其他类型（`image`/`audio`/`resource`/`resource_link`）标记 `Kind: "message"` 且 `Text` 为空并置 `Raw`，由上层发 `warning`
- [x] 5.4 新建 `internal/acp/client.go`，定义 `Client` 与 `ClientInfo`，实现 `Initialize(ctx) (InitializeResult, error)`：发 `{protocolVersion: 1, clientCapabilities: {fs:{readTextFile:false,writeTextFile:false}, terminal:false}, clientInfo:{name:"llmwiki", title:"LLM Wiki", version:<main.Version>}}`
- [x] 5.5 在 `Initialize` 后校验返回的 `protocolVersion`：不等于 1 时返回 `ErrProtocolVersionUnsupported` 并携带对端版本号
- [x] 5.6 实现 `NewSession(ctx, cwd string) (string, error)`：发 `session/new{cwd, mcpServers: []}`，返回 `sessionId`
- [x] 5.7 实现 `Prompt(ctx context.Context, sessionID, text string, h Handlers) (stopReason string, err error)`：发 `session/prompt{sessionId, prompt: [{type:"text", text}]}`，期间 `Handlers.OnEvent` 收 `session/update`、`Handlers.OnPermission` 处理 `session/request_permission`
- [x] 5.8 在 `Prompt` 中实现 idle 看门狗：每次 `session/update` 刷新 `lastActivity`；超过 `idle_timeout_ms` 无活动则触发取消序列
- [x] 5.9 实现 `Cancel(sessionID string) error`（发 `session/cancel` notification）与取消等待：发出后等 `session/prompt` 返回，上限 5s，超时返回 `ErrCancelTimeout`
- [x] 5.10 实现 `Close() error`（关 stdin → 等 2s → `Terminate()`）
- [x] 5.11 新建 `internal/acp/client_test.go`，用 fake agent 覆盖：initialize + session/new + 正常 prompt 拿到 `end_turn`；protocolVersion 不匹配报错；thought 与 message 分流；tool_call/tool_call_update 事件顺序；idle 超时触发取消；`Cancel` 后拿到 `cancelled`；agent 崩溃时 `Prompt` 返回错误且 `StderrTail` 非空

## 6. 权限决策（`internal/acp/permission.go`）

- [x] 6.1 新建 `internal/acp/permission.go`，定义 `PermissionRequest{SessionID string; ToolCallID,ToolKind,ToolTitle string; Options []PermissionOption}`、`PermissionOption{OptionID,Name,Kind string}`、`PermissionDecision{Outcome string; OptionID string; Allowed bool; Reason string; ToolKind string; ToolTitle string}`
- [x] 6.2 实现 `Decide(policy PermissionPolicy, readonlyOnly bool, req PermissionRequest) PermissionDecision`，按 design D9 的矩阵：`read`→`allow_read`、`search`→`allow_search`、`think`→恒允许、`fetch`→`allow_fetch`、`edit|delete|move`→`allow_write && !readonlyOnly`、`execute`→`allow_execute && !readonlyOnly`、`other`/未知/缺失→拒绝
- [x] 6.3 实现选项挑选：允许时只找 `kind == "allow_once"` 的 option，拒绝时只找 `kind == "reject_once"`；**不接受 `allow_always`/`reject_always`**；找不到匹配 option 时返回 `Outcome: "cancelled"`、`Reason: "no_matching_option"`
- [x] 6.4 实现 `CancelledDecision(req PermissionRequest) PermissionDecision`，供 turn 已取消时对 pending 请求统一应答
- [x] 6.5 新建 `internal/acp/permission_test.go`，用表驱动覆盖全部 kind × 全部开关组合，外加：`readonly_only=true` 时 `allow_write=true` 仍拒绝 `edit`；options 中只有 `allow_always` 时返回 `cancelled`；未知 kind `"frobnicate"` 被拒绝；空 kind 被拒绝

## 7. 进程池与探活（`internal/acp/manager.go`、`check.go`）

- [x] 7.1 新建 `internal/acp/manager.go`，实现 `Manager{mu sync.Mutex; conns map[string]*Conn; maxConcurrent int}` 与 `NewManager(maxConcurrent int) *Manager`
- [x] 7.2 实现 `func (m *Manager) Acquire(ctx context.Context, sessionID string, cfg AgentConfig, cwd string) (*Conn, error)`：已有则复用；无则检查 `len(conns) < maxConcurrent`（超限返回 `ErrTooManyAgents`）后 spawn + `Initialize` + `NewSession` 并入池
- [x] 7.3 实现 `func (m *Manager) Invalidate(sessionID string)`（崩溃后从池移除并 `Terminate`）、`func (m *Manager) CloseSession(sessionID string)`、`func (m *Manager) CloseAll()`
- [x] 7.4 在 `Conn` 上记录 `RemoteSessionID`、`AgentInfo`、`ProtocolVersion`、`StartedAt`、`HistoryReplayed bool`，供 runtime 判断是否需要注入历史引导
- [x] 7.5 新建 `internal/acp/check.go`，定义 `AgentCheckResult{ID,Name string; Enabled bool; Status,Code,Message string; AgentName,AgentVersion string; ProtocolVersion int}`
- [x] 7.6 实现 `CheckAgents(ctx context.Context, cfg *Config, workspace string) []AgentCheckResult`：`enabled=false`→`disabled`；`exec.LookPath` 失败→`error`/`cli_not_found`；否则 spawn+initialize（超时 `min(init_timeout_ms, 15000)`）后立即 `Terminate`；版本不符→`error`/`protocol_version_unsupported`
- [x] 7.7 实现 `Availability(cfg *Config) map[string]AvailabilityResult`（轻量：仅 `exec.LookPath`，不 spawn），返回 `{Available bool; Reason string}`
- [x] 7.8 新建 `internal/acp/manager_test.go` 与 `check_test.go`，用 fake agent 覆盖：复用同一 `Conn`；超过 `maxConcurrent` 返回 `ErrTooManyAgents`；`Invalidate` 后重新 `Acquire` 会新建进程；`CloseAll` 后无残留；`CheckAgents` 三种状态；`Availability` 对不存在命令返回 `Available=false`

## 8. Runtime 接缝与 native 实现（`internal/agentruntime`）

- [x] 8.1 新建 `internal/agentruntime/runtime.go`，定义 `KindNative`/`KindACP` 常量与 `Runtime`、`PromptRequest`、`PromptResult`、`EventSink`、`PlanEntry`、`PermissionDecision` 类型（签名见 design D2）
- [x] 8.2 新建 `internal/agentruntime/native.go`，实现 `nativeRuntime`：构造时经 `llm.ClientFromInstance` 解析 client（失败则在 `Resolve` 阶段返回可分类错误），`Prompt` 内部依次调 `ingest.ContextResolver`、`ingest.AssembleIngestChatMessages`、`ingest.RunSessionChatToolLoop`，并把 tool 回调与 recorder 事件转发到 `EventSink`
- [x] 8.3 在 `nativeRuntime.Prompt` 中保留现有 fallback：tool loop 失败时 `sink.Warning("tool_loop_failed", err.Error())` 后走 `ingest.StripToolMessages` + `client.StreamChat`，逐 token `sink.Token`
- [x] 8.4 新建 `internal/agentruntime/resolve.go`，实现 `Resolve(db *sqlite.DB, workspace string, mgr *acp.Manager, session *sqlite.IngestSession) (Runtime, error)`：`session.AgentKind == acp` 走 ACP 分支（读 `acp_agents_json`、校验 agent 存在/enabled/`Availability`），否则 native；`agent_kind` 为空串按 native 处理
- [x] 8.5 定义可分类的哨兵错误 `ErrNoProviderInstance`、`ErrNoACPAgent`、`ErrACPAgentDisabled`、`ErrACPCLINotFound`、`ErrACPConfigInvalid`，供 `internal/api` 映射到不同的 400 文案
- [x] 8.6 新建 `internal/agentruntime/native_test.go`，用 stub LLM server（`httptest`）覆盖：正常 tool loop 输出经 `EventSink` 透出、tool loop 失败触发 `Warning` 与 fallback、instance 缺失时 `Resolve` 返回 `ErrNoProviderInstance`
- [x] 8.7 新建 `internal/agentruntime/resolve_test.go`，覆盖：`agent_kind` 为空/`native`/`acp` 三种分派、ACP agent id 不存在、agent disabled、CLI 不存在各返回对应哨兵错误

## 9. ACP runtime 实现（`internal/agentruntime/acp.go`）

- [x] 9.1 新建 `internal/agentruntime/acp.go`，实现 `acpRuntime{mgr *acp.Manager; workspace string; cfg acp.Config; agent acp.AgentConfig}` 与 `Kind()`/`Label()`（`Label` 返回 `"acp / " + agent.Name`）
- [x] 9.2 实现 `Prompt`：`acp.ResolveCWD` → `mgr.Acquire` → 若 `Conn.HistoryReplayed == false` 且 `len(req.History) > 0` 则前置历史引导文本（把 `req.History` 渲染为 `## User` / `## Assistant` 段落，沿用 48 条上限，末尾追加本轮 `req.UserContent`），并置 `HistoryReplayed = true`；否则只发 `req.UserContent`
- [x] 9.3 实现事件转发：`Kind=message` → `sink.Token`；`thought` → `sink.Thought`；`tool_call` → `sink.ToolStart(name, title/rawInput 截断)`；`tool_call_update` 且 `status ∈ {completed, failed}` → `sink.ToolDone`；`plan` → `sink.Plan`；`usage`/`user_echo`/`ignored` → 仅 `sink.Debug`
- [x] 9.4 实现非 text `ContentBlock` 的处理：`sink.Warning("acp_unsupported_content", ...)` + `sink.Debug`，不写入正文
- [x] 9.5 实现权限回调：调 `acp.Decide(agent.Permission, cfg.Defaults.ReadonlyOnly, req)`，把 `PermissionDecision` 交给 `sink.Permission` 并返回协议 outcome；turn 已取消时统一用 `acp.CancelledDecision`
- [x] 9.6 实现 `stopReason` → `PromptResult.StopReason` 透传，并在返回前 `sink.Debug("acp_turn", "acp_stop_reason", ...)`
- [x] 9.7 实现崩溃自动重启：`Prompt` 返回进程级错误且本 turn 尚未产生任何 `Token` 时，`mgr.Invalidate` 后重试一次（最多一次），并 `sink.Debug("acp_turn", "acp_process_restart", ...)`；已产生输出则不重试，直接返回错误
- [x] 9.8 实现取消：`ctx.Done()` 时调 `Client.Cancel` 并等待 `cancelled`，`acp.ErrCancelTimeout` 时 `mgr.Invalidate`
- [x] 9.9 实现 `prompt_timeout_ms`：用 `context.WithTimeout` 包裹，超时走与取消相同的序列并返回可分类的超时错误
- [x] 9.10 新建 `internal/agentruntime/acp_test.go`，用 fake agent 覆盖：正常 turn 的 Token/Thought/ToolStart/ToolDone 顺序；权限被拒后 agent 收到 `reject_once`；取消得到 `cancelled` 与 `StopReason=cancelled`；崩溃在首 Token 前自动重启一次、在首 Token 后不重启；prompt 超时触发取消序列；进程重启后第二轮注入历史引导

## 10. API 层 —— ACP agent 管理与 Settings

- [x] 10.1 新建 `internal/api/acp_agents.go`，实现 `func (a *API) ListACPAgents(w, r)`：读 `acp_agents_json` → `acp.ParseConfig` → `acp.RedactedAgents` + `acp.Availability` 合并，返回 `{"agents": [...]}`；配置非法时返回 200 且带 `config_error` 字段（避免非法配置把页面打死）
- [x] 10.2 实现 `func (a *API) CheckACPAgents(w, r)`：可选 body `{"acp_agents_json": "..."}` 探测未保存配置（形态照抄 `CheckMCPStatus`），否则读库；返回 `{"agents": [AgentCheckResult...]}`；解析失败返回 400 并带 `ValidationError` 的 path
- [x] 10.3 在 `internal/server/server.go` 的 `/api/v1` 路由块注册 `r.Route("/acp-agents", ...)`：`Get("/", s.api.ListACPAgents)`、`Post("/check", s.api.CheckACPAgents)`（位置紧随 `provider-instances` 之后）
- [x] 10.4 在 `internal/api/settings.go` 的 `settingsResponse` 新增 `ACPAgentsJSON string \`json:"acp_agents_json"\``、`DefaultAgentKind string \`json:"default_agent_kind"\``、`DefaultACPAgentID string \`json:"default_acp_agent_id"\``、`ACPMaxConcurrentAgents string \`json:"acp_max_concurrent_agents"\``
- [x] 10.5 实现 `acpAgentsJSONForResponse(stored string) string`（空串返回 `acp.CanonicalJSON(acp.DefaultConfig())`，解析失败原样返回，成功则返回 canonical）与 `defaultAgentKindForResponse(stored string) string`（非 `acp` 一律返回 `native`），在 `GetSettings` 中接入
- [x] 10.6 在 `UpdateSettings` 的 `allowedKeys` 增加四个键，并加校验：`acp_agents_json` 经 `acp.ParseConfig` + `acp.CanonicalJSON` 规范化后落库（失败返回 400 带 path，凭据类校验失败同样在此拦截）；`default_agent_kind` 必须为 `native`/`acp`；`default_acp_agent_id` 若非空必须存在于当前（含本次提交的）`acp_agents_json` 的 agents 中；`acp_max_concurrent_agents` 为 1–16 的整数
- [x] 10.7 在 `internal/server/server.go` 的 `handleHealth` 的 `mode` map 中新增 `"acp_enabled"`，值为「配置可解析且 `HasEnabledAgent()`」
- [x] 10.8 扩展 `internal/api/settings_test.go`：GET 返回四个新键与默认值；PUT 合法配置落库为 canonical；PUT 非法 JSON 返回 400 且 body 含 path；PUT `default_agent_kind: "bogus"` 返回 400；PUT `default_acp_agent_id` 指向不存在 agent 返回 400；PUT 含 `args: ["--api-key","sk-abcdefgh"]` 返回 400 且 body 含 path `agents.<id>.args[1]` 与 `env_passthrough` 指引；PUT 含 `env` 键返回 400 且 path 为 `agents.<id>.env`；PUT `env_passthrough: ["SOME_PROVIDER_API_KEY"]` 成功落库
- [x] 10.9 新建 `internal/api/acp_agents_test.go`：`GET /acp-agents` 空配置返回空数组；含 agent 时响应**不含任何环境变量值**、`env_passthrough` 为 `{name, present}` 形态（含一个进程环境中确实存在的变量断言 `present=true`，一个不存在的断言 `present=false`）；非法配置返回 200 + `config_error`；`POST /acp-agents/check` 对不存在命令返回 `cli_not_found`；`check` 支持 body 覆盖

## 11. API 层 —— session runtime 切换与流式接入

- [x] 11.1 在 `internal/api/api.go` 新增 `func (a *API) sessionAgentRuntime(session *sqlite.IngestSession) (agentruntime.Runtime, error)`，内部调 `agentruntime.Resolve(a.db, a.workspace, a.acpMgr, session)`；新增 `acpMgr *acp.Manager` 字段与 `SetACPManager(*acp.Manager)`
- [x] 11.2 新增 `func runtimeErrorMessage(err error) string`，把 `agentruntime` 的哨兵错误映射为面向用户的中文文案：`ErrNoProviderInstance`→"请先选择 Provider 实例和 Model"（保持现有文案）、`ErrNoACPAgent`→"请先在 Settings 配置并选择 ACP Agent"、`ErrACPAgentDisabled`→"该 ACP Agent 已禁用"、`ErrACPCLINotFound`→"ACP Agent 命令未找到，请确认已安装并在 PATH 中"、`ErrACPConfigInvalid`→带 path 的配置错误
- [x] 11.3 新增 `internal/api/session_event_sink.go`：实现 `sseEventSink`，持有 `sendEvent func(string, interface{})`、`*sqlite.DB`、`assistantMsgID`、`*ingest.SessionMessageRecorder` 与节流状态；`Token` 追加缓冲并按现有节流规则（`>=32` 字符或 `>=300ms`）调 `UpdateIngestSessionMessageContent(id, buf, "streaming")` 并发 SSE `token`
- [x] 11.4 在 `sseEventSink` 实现 `Thought`（发 SSE `thought` + `Record("acp_turn","agent_thought",...)`）、`ToolStart`/`ToolDone`（发现有的 `tool_start`/`tool_done`，字段名保持 `{tool, detail}`）、`Plan`（发 SSE `plan` + 记录）、`Permission`（发 SSE `permission` + 记录 + `activity.Record{Category:"agent", Action:"acp_permission"}`）、`Warning`（发现有的 `warning`）、`Debug`（仅 recorder）
- [x] 11.5 重构 `internal/api/ingest_session.go` 的 `streamAssistantReply`：把 `a.sessionLLMClient` 与 tool loop 调用替换为 `a.sessionAgentRuntime(session)` + `runtime.Prompt(ctx, req, sink)`；保留现有的 SSE header 设置、`user_message`/`assistant_start` 发送、空正文→`failed`、`done` 事件与 `activity.LogSession` 失败记录
- [x] 11.6 在 `streamAssistantReply` 中按 `PromptResult.StopReason` 决定 `stream_status`：`end_turn|max_tokens|max_turn_requests`→`complete`、`cancelled`→`incomplete`、`refusal`→`failed`；正文为空时统一降为 `failed`
- [x] 11.7 简化 `streamSessionReply`：把开头的 `a.sessionLLMClient` 前置检查改为 `a.sessionAgentRuntime(session)`，错误经 `runtimeErrorMessage` 返回 400；ACP 模式下不再触发任何 provider instance 查询
- [x] 11.8 删除或内联 `streamSessionChatDirect`（其逻辑已迁入 `agentruntime.nativeRuntime`），确保 `internal/api` 不再直接持有 `*llm.Client` 用于 session chat（`summarizeAttachment` 仍保留 `instanceLLMClient` 用法，不改）
- [x] 11.9 在 `CreateIngestSession` 的请求结构体新增 `AgentKind string \`json:"agent_kind"\`` 与 `ACPAgentID string \`json:"acp_agent_id"\``；缺省时读 `app_config` 的 `default_agent_kind` / `default_acp_agent_id`；仍为空则 `native`；写入 `sqlite.IngestSession`
- [x] 11.10 在 `UpdateIngestSessionHandler` 的请求结构体新增同名字段；`agent_kind` 非法值返回 400；`agent_kind == "acp"` 且 `acp_agent_id` 为空或不存在于配置返回 400；session 有 streaming assistant 时返回 409；session 已 `archived` 返回 409；成功时调 `UpdateIngestSessionAgent` 并同步写 `default_agent_kind` / `default_acp_agent_id`
- [x] 11.11 在 `DeleteIngestSessionHandler` 与 `ArchiveIngestSession` 成功路径调用 `a.acpMgr.CloseSession(sessionID)`（nil-safe）
- [x] 11.12 在 `cmd/llmwiki/serve.go` 构造 `acp.NewManager(n)`（`n` 读 `app_config.acp_max_concurrent_agents`，缺省 `acp.DefaultMaxConcurrentAgents`）并经 `server.Config` 传入；在 `internal/server/server.go` 的 `New` 中调 `srv.api.SetACPManager(cfg.ACPManager)`，在 `Shutdown` 中 `s.http.Shutdown` 之后调 `cfg.ACPManager.CloseAll()`
- [x] 11.13 扩展 `internal/api/ingest_session_test.go`：`POST /sessions` 继承 `default_agent_kind`；`POST /sessions` 显式传 `agent_kind: "acp"` + 有效 `acp_agent_id`；`PATCH` 切 runtime 成功并回写 default；`PATCH` 非法 `agent_kind` 400；`PATCH` `acp` 但 agent 不存在 400；`PATCH` streaming 中 409；`PATCH` 已归档 409；ACP session 在**无任何 provider instance** 时 `POST /messages?stream=1` 的错误信息**不含** "Provider" 字样；native session 行为回归（现有断言不改即通过）
- [x] 11.14 新建 `internal/api/session_event_sink_test.go`：`Token` 节流后正文完整落库；`Thought` 不进 `ingest_session_messages.content` 但进 `session_message_events`；`Permission` 同时产生 SSE 事件与 activity log；SSE 事件名与既有 `tool_start`/`tool_done` 载荷字段一致

## 12. 前端 —— 类型、API、状态

- [x] 12.1 在 `web/src/types.ts` 新增 `export type AgentKind = "native" | "acp"`、`ACPAgentEnvVar{name, present}`、`ACPAgent{id, name, enabled, command, args, cwd_policy, permission, env_passthrough, available, unavailable_reason}`、`ACPAgentCheckResult{id, name, enabled, status, code?, message?, agent_name?, agent_version?, protocol_version?}`
- [x] 12.2 在 `web/src/types.ts` 扩展 `IngestSession` 与 `SessionListItem`（新增 `agent_kind: AgentKind`、`acp_agent_id: string`）与 `Settings`（新增 `acp_agents_json?`、`default_agent_kind?`、`default_acp_agent_id?`、`acp_max_concurrent_agents?`）
- [x] 12.3 在 `web/src/lib/api.ts` 新增 `listACPAgents(): Promise<{agents: ACPAgent[]; config_error?: string}>` 与 `checkACPAgents(acpAgentsJson?: string): Promise<{agents: ACPAgentCheckResult[]}>`
- [x] 12.4 扩展 `web/src/lib/api.ts` 的 `createIngestSession`（接受可选 `agentKind`/`acpAgentId`）与 `updateIngestSession`（patch 类型加 `agent_kind?`、`acp_agent_id?`）
- [x] 12.5 在 `web/src/context/AppContext.tsx` 的 `AppState` 新增 `acpAgents: ACPAgent[]`、`acpConfigError: string | null`、`loadACPAgents(): Promise<void>`、`updateSessionAgent(id, agentKind, acpAgentId): Promise<void>`
- [x] 12.6 实现 `loadACPAgents`（调 `api.listACPAgents`，写 `acpAgents` 与 `acpConfigError`）与 `updateSessionAgent`（调 `api.updateIngestSession` 后 `listSessionsInternal()`，并乐观更新 `settings.default_agent_kind`/`default_acp_agent_id`）
- [x] 12.7 在 `applyAssistantStreamEvent` 中处理三个新事件：`thought` 累积到消息的 `thought_text`；`plan` 写入 `plan_entries`；`permission` 转成 `tool_status` 行内提示文案。相应扩展 `IngestSessionMessage` 的客户端专用字段（`thought_text?`、`plan_entries?`）
- [x] 12.8 在 `createSession`、`ensureIngestSession`、`deleteSession` 的新建分支中，把 `settings.default_agent_kind` / `default_acp_agent_id` 一并传给 `api.createIngestSession`
- [x] 12.9 扩展 `web/src/lib/api.test.ts`：`listACPAgents`/`checkACPAgents` 的 URL 与方法；`updateIngestSession` 带 runtime 字段的 body
- [x] 12.10 扩展 `web/src/app-context-streaming.test.tsx`：`thought`/`plan`/`permission` 事件被正确聚合；未知事件名不破坏流；native 流式行为回归

## 13. 前端 —— UI

- [x] 13.1 改造 `web/src/components/ModelSelectDialog.tsx`：顶部新增「Agent 运行时」分段控件（`native` / 每个 enabled 的 ACP agent），props 增加 `agentKind`、`acpAgentId`、`acpAgents`、`onConfirm(runtime)`；确认时按 runtime 分派 `updateSessionAgent` 或现有 `updateSessionLLM`
- [x] 13.2 在 `ModelSelectDialog` 的 ACP 模式下把 instance / model 两个 `<select>` 设为 `disabled` 并显示说明文案（不隐藏，保证切回 native 可见）；ACP agent 不可用时在选项旁显示原因
- [x] 13.3 改造 `web/src/components/IngestChat.tsx` 的 `isReady`：按 `agentKind` 分支（native 要求 instance+model；acp 要求选中 agent 且 `enabled && available`），`textareaDisabled`/`sendDisabled`/`attachDisabled` 随之生效
- [x] 13.4 在 `IngestChat` 的未就绪提示区按原因分文案：无 ACP agent 配置 / 未选 agent / agent 已禁用 / CLI 未安装 / native 的 provider 未配置
- [x] 13.5 在 `IngestChat` 输入区上方的状态行把 `Bot`+instance / `Cpu`+model 替换为 runtime 感知展示：ACP 模式显示 agent 名与 `ACP` badge，native 模式保持现有 instance/model 展示
- [x] 13.6 在 `MessageBubble` 渲染 `thought_text`（`<details>` 折叠，标题走 i18n `chat.agent.thought`）与 `plan_entries`（有序列表 + status 标记）
- [x] 13.7 在 `web/src/components/SessionControls.tsx` 的 session 行副标题中，ACP session 显示 `ACP / <agent name>`，native 保持 `<instance name> / <model>`；`handleNewChat` 传递默认 runtime
- [x] 13.8 在 `web/src/components/SettingsPage.tsx` 的 `settings-group-models` 分组内新增 ACP Agents 卡片：默认 runtime 选择器 + 默认 agent 选择器 + `acp_agents_json` 文本域 + `data-testid="check-acp-agents"` 检查按钮 + 结果列表（交互与既有 MCP 卡片一致）
- [x] 13.9 在 ACP 卡片中显示每个 agent 的 `env_passthrough` 变量名与 `present` 状态（值永不显示，也不提供任何变量值输入框；卡片说明文案指出凭据只能通过 llmwiki 进程环境提供），并在 `readonly_only=false` 时显示写权限告警文案
- [x] 13.10 在 `web/src/i18n/messages/zh.ts` 与 `en.ts` 新增 `settings.acp.*`、`settings.groups.models.desc` 调整、`chat.agent.*`、`model.runtime.*` 全部文案键（两个文件键集必须完全一致）
- [x] 13.11 新建 `web/src/acp-agents.test.tsx`：Settings ACP 卡片渲染 agent 列表；检查按钮调 `checkACPAgents` 并渲染 `ok`/`error`/`disabled` 三态；非法 JSON 显示错误 path；`env_passthrough` 只显示变量名与状态且页面上不存在任何变量值输入框
- [x] 13.12 扩展 `web/src/ingest-chat.test.tsx`：ACP session 且 agent 可用时输入框启用（**即使 `instances` 为空**）；ACP session 且 CLI 不可用时输入框禁用并显示对应文案；native session 守卫行为回归；`thought`/`plan` 渲染
- [x] 13.13 扩展 `web/src/settings-page.test.tsx`：ACP 卡片位于「模型与连接」分组内；默认 runtime 切换触发 `updateSettings`；保存动作走页面级 save bar

## 14. 文档与部署验证

- [x] 14.1 新建 `docs/16-acp-agent-runtime.md`：架构图（api → agentruntime → acp → 子进程）、配置字段表、凭据边界（`env_passthrough` 只声明变量名 + `command`/`args` 不得夹带凭据）、权限矩阵、事件映射表、故障排查（CLI 未找到 / 版本不匹配 / 超时 / 崩溃 / 变量 `present=false`）、以及「开发期用 acpx 手工连 agent 看原始报文」的调试小节（明确 acpx 不是运行时依赖）
- [x] 14.2 更新 `README.md`：Prerequisites 增加「可选：本机 ACP agent CLI」；API Endpoints 表新增 `GET /api/v1/acp-agents`、`POST /api/v1/acp-agents/check`；新增「Agent Runtime（native / ACP）」章节说明 session 级切换与默认值；Language/Settings 附近说明四个新配置键
- [x] 14.3 在 `README.md` 的架构章节说明 ACP 子进程的生命周期与安全默认（只读、非交互权限、cwd 限定 workspace、不开放 `fs/*` 与 `terminal/*`、子进程环境为白名单）
- [x] 14.4 编写 lnv 部署影响说明（写入 `docs/16-acp-agent-runtime.md` 的「部署」小节）：默认镜像**不装** ACP CLI，`default_agent_kind` 默认 `native`，现有 `lwiki:<sha>` 镜像与 `/home/wii/.agent-deploy/lnv/llmwiki/docker-compose.yml` 无需改动
- [x] 14.5 在同一小节给出可选 `lwiki-acp:<sha>` 镜像变体方案：`debian:bookworm-slim` 基础上加 `nodejs npm` 与所选 ACP CLI，说明体积影响与「必须 glibc 基础镜像、不能用 alpine」的既有约束
- [x] 14.6 给出凭据注入约定：agent 所需 API key 通过 compose `env_file: /home/wii/.agent-deploy/lnv/llmwiki/.env.acp`（权限 600，不入任何 git 仓）注入 llmwiki 进程环境；`acp_agents_json` 里只出现 `env_passthrough` 变量名；明确 compose、仓库与 `acp_agents_json` 均不得出现明文密钥，`args` 里也不行
- [x] 14.7 给出部署后验证清单：`curl -k https://llmwiki.lan/api/v1/health` 的 `mode.acp_enabled` 字段；`curl` `GET /api/v1/acp-agents` 检查 `available` 与 `env_passthrough[].present`；`POST /api/v1/acp-agents/check` 检查 `status/agent_version/protocol_version`；容器内 `docker exec lnv-llmwiki sh -c 'command -v <cli>'`
- [x] 14.8 运行完整验证：`make lint`、`make test`、`cd web && npm run lint && npm test`、`make build`，全部通过
- [ ] 14.9 手动端到端（本机 `make dev` + 一个真实 ACP agent CLI）：Settings 配置 agent → 检查连接 ok → 新建 session 切 ACP → 发消息看到 token/thought/tool 流 → 刷新页面历史与 debug 事件仍在 → 点 Stop 得到 `incomplete` → 归档进入 review → 切回 native 发消息正常 → 停服务后 `ps` 确认无残留 agent 进程
