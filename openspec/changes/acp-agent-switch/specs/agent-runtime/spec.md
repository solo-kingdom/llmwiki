## ADDED Requirements

### Requirement: Agent runtime 抽象接缝
系统 SHALL 在 `internal/agentruntime` 定义 agent runtime 抽象，使 `internal/api` 与 `internal/ingest` 对 native 与 ACP 两种实现无差别调用。该抽象 SHALL 至少包含 `Runtime` 接口（`Kind() string`、`Label() string`、`Prompt(ctx, PromptRequest, EventSink) (PromptResult, error)`）、`PromptRequest`、`PromptResult`、`EventSink`。ACP 协议概念（JSON-RPC 方法名、`sessionUpdate` 变体、`stopReason` 原始值以外的协议细节、子进程、权限选项）SHALL NOT 出现在 `internal/api` 与 `internal/ingest` 的类型或函数签名中。

#### Scenario: Runtime kind 常量
- **WHEN** 实现方需要标识 runtime 类型
- **THEN** 系统 SHALL 提供常量 `KindNative = "native"` 与 `KindACP = "acp"`
- **AND** 这两个值 SHALL 与 `ingest_sessions.agent_kind` 的取值域一致

#### Scenario: API 层不依赖 ACP 包
- **WHEN** 检查 `internal/api` 与 `internal/ingest` 的导入
- **THEN** 除 `internal/api` 为构造 `acp.Manager` 所需的最小引用外，SHALL NOT 出现对 `internal/acp` 的协议类型（如 `acp.PermissionOption`、`acp.Event`）的依赖

#### Scenario: Runtime 解析入口
- **WHEN** 调用 `agentruntime.Resolve(db, workspace, mgr, session)`
- **THEN** 系统 SHALL 依据 `session.AgentKind` 返回对应 `Runtime` 实现
- **AND** `session.AgentKind` 为空字符串时 SHALL 按 `native` 处理

#### Scenario: 可分类的解析错误
- **WHEN** runtime 无法构造
- **THEN** `Resolve` SHALL 返回可用 `errors.Is` 判定的哨兵错误之一：`ErrNoProviderInstance`、`ErrNoACPAgent`、`ErrACPAgentDisabled`、`ErrACPCLINotFound`、`ErrACPConfigInvalid`

### Requirement: Native runtime 行为保持不变
Native runtime SHALL 封装现有自研 agent 路径，行为与本变更前逐项等价：经 `llm.ClientFromInstance` 构造客户端，经 `ingest.AssembleIngestChatMessages` 组装消息，经 `ingest.RunSessionChatToolLoop` 执行只读 tool loop，失败时经 `ingest.StripToolMessages` 回退直接流式。

#### Scenario: Tool loop 正常完成
- **WHEN** native runtime 的 tool loop 返回非空正文
- **THEN** 该正文 SHALL 经 `EventSink.Token` 透出
- **AND** `PromptResult.StopReason` SHALL 为 `end_turn`

#### Scenario: Tool loop 失败回退
- **WHEN** `ingest.RunSessionChatToolLoop` 返回错误
- **THEN** runtime SHALL 调用 `EventSink.Warning("tool_loop_failed", <error>)`
- **AND** SHALL 用剥除 tool 消息后的历史发起直接流式请求
- **AND** 回退产生的 token SHALL 同样经 `EventSink.Token` 透出

#### Scenario: Provider instance 缺失
- **WHEN** session 的 `agent_kind` 为 `native` 且 instance 或 model 未配置，或该 instance 的 `api_key` 为空
- **THEN** `Resolve` SHALL 返回 `ErrNoProviderInstance`

### Requirement: ACP client 协议实现
系统 SHALL 在 `internal/acp` 实现 ACP client，使用 JSON-RPC 2.0 over stdio（换行分隔），协议版本声明为 `1`。实现 SHALL 覆盖出站 `initialize`、`session/new`、`session/prompt`、`session/cancel`，以及入站 `session/update`（notification）与 `session/request_permission`（request）。实现 SHALL NOT 引入新的 Go 模块依赖。

#### Scenario: initialize 参数
- **WHEN** 建立与 ACP agent 的连接
- **THEN** 系统 SHALL 发送 `initialize` 且 `params.protocolVersion` 为 `1`
- **AND** `params.clientCapabilities` SHALL 为 `{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}`
- **AND** `params.clientInfo.name` SHALL 为 `llmwiki`

#### Scenario: 协议版本不匹配
- **WHEN** agent 的 `initialize` 响应中 `protocolVersion` 不等于 `1`
- **THEN** 系统 SHALL 关闭连接并返回携带对端版本号的错误
- **AND** SHALL NOT 继续发送 `session/new` 或 `session/prompt`

#### Scenario: session/new 使用绝对工作目录
- **WHEN** 创建 ACP session
- **THEN** 系统 SHALL 发送 `session/new` 且 `params.cwd` 为绝对路径
- **AND** `params.mcpServers` SHALL 为空数组

#### Scenario: session/prompt 内容块
- **WHEN** 发送一次用户提示
- **THEN** `params.prompt` SHALL 至少包含一个 `{"type":"text","text":...}` 内容块
- **AND** SHALL NOT 使用未经 `promptCapabilities` 声明的内容块类型

#### Scenario: 未知 sessionUpdate 变体
- **WHEN** agent 发来的 `session/update` 的 `update.sessionUpdate` 不在已知集合内
- **THEN** 系统 SHALL 忽略该更新而不报错
- **AND** SHALL 记录一条调试事件供诊断

#### Scenario: 未知入站方法
- **WHEN** agent 调用系统未实现的 client 方法（如 `fs/read_text_file`、`terminal/create`）
- **THEN** 系统 SHALL 回复 JSON-RPC 错误码 `-32601`
- **AND** SHALL NOT 因此终止连接

### Requirement: ACP agent 通用配置
ACP agent 配置 SHALL 存储于 `app_config` 的 `acp_agents_json`，为版本化 JSON 文档，形态与 `mcp_servers_json` 一致（`version` + 以 id 为 key 的对象 + `defaults`）。配置 SHALL NOT 包含任何针对特定 agent 产品的枚举、分支或硬编码。

#### Scenario: 配置字段集合
- **WHEN** 定义一个 agent
- **THEN** 系统 SHALL 支持 `id`、`name`、`enabled`、`command`、`args`、`env_passthrough`、`cwd_policy`、`init_timeout_ms`、`prompt_timeout_ms`、`idle_timeout_ms`、`permission`
- **AND** `defaults` SHALL 支持 `readonly_only` 与 `on_unavailable`
- **AND** 配置 SHALL NOT 定义任何用于存放环境变量值的字段

#### Scenario: 空配置合法
- **WHEN** `acp_agents_json` 为空字符串或未设置
- **THEN** `ParseConfig` SHALL 返回含空 `agents` 的默认配置而不报错

#### Scenario: id 必须与 key 一致
- **WHEN** `agents` 中某项的 `id` 与其 map key 不同
- **THEN** 校验 SHALL 失败并返回 path `agents.<key>.id`

#### Scenario: command 拒绝 shell 元字符
- **WHEN** `command` 含 `;`、`|`、`&`、`` ` ``、`$` 等 shell 元字符
- **THEN** 校验 SHALL 失败并说明系统不经 shell 启动进程

#### Scenario: cwd_policy 取值受限
- **WHEN** `cwd_policy` 不是 `workspace` 或 `session`
- **THEN** 校验 SHALL 失败并返回 path `agents.<id>.cwd_policy`

#### Scenario: 超时边界
- **WHEN** `init_timeout_ms` 不在 1000–120000、`prompt_timeout_ms` 不在 5000–3600000、或 `idle_timeout_ms` 不在 5000–600000
- **THEN** 校验 SHALL 失败并返回对应字段 path

#### Scenario: 非交互权限模式
- **WHEN** `permission.mode` 不是 `auto`
- **THEN** 校验 SHALL 失败（本版本不支持交互式审批）

#### Scenario: 写权限需双开关
- **WHEN** `defaults.readonly_only` 为 `true` 且某 agent 的 `permission.allow_write` 或 `allow_execute` 为 `true`
- **THEN** 校验 SHALL 失败并提示需同时关闭 `defaults.readonly_only`

#### Scenario: 不允许静默降级
- **WHEN** `defaults.on_unavailable` 不是 `error`
- **THEN** 校验 SHALL 失败

#### Scenario: 配置落库规范化
- **WHEN** 合法配置被保存
- **THEN** 系统 SHALL 以 `CanonicalJSON` 的规范化结果落库
- **AND** 对同一语义配置重复规范化 SHALL 得到相同字符串

### Requirement: 凭据只经进程环境传递
系统 SHALL NOT 在配置、数据库或 API 响应中存储或回显任何环境变量值。凭据 SHALL 仅通过 llmwiki 进程环境传递，配置中只声明变量名。配置、`command` 与 `args` SHALL NOT 成为凭据的载体。

#### Scenario: env_passthrough 名称格式校验
- **WHEN** `env_passthrough` 中某一项不匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，或为空串，或与同一 agent 内的其他项重复
- **THEN** 校验 SHALL 失败并返回 path `agents.<id>.env_passthrough[<i>]`

#### Scenario: env_passthrough 允许声明凭据变量名
- **WHEN** `env_passthrough` 中的变量名含 `KEY`、`TOKEN`、`SECRET`、`PASSWORD` 等子串（如 `SOME_PROVIDER_API_KEY`、`GITHUB_TOKEN`）
- **THEN** 校验 SHALL 通过
- **AND** 系统 SHALL NOT 因名称疑似凭据而拒绝——透传凭据变量正是该字段的正当用途

#### Scenario: 配置出现环境变量值字段被拒
- **WHEN** 某个 agent 对象中出现 `env` 键
- **THEN** 校验 SHALL 失败并返回 path `agents.<id>.env`
- **AND** 错误信息 SHALL 说明配置不接受环境变量值，应改用 `env_passthrough` 只声明变量名
- **AND** 系统 SHALL NOT 静默丢弃该字段

#### Scenario: args 拒绝凭据参数名
- **WHEN** `args` 中某一项（大小写不敏感，`--k v` 与 `--k=v` 两种形式均计入）为 `--token`、`--api-key`、`--api_key`、`--password`、`--secret`、`--authorization` 或 `--header`
- **THEN** 校验 SHALL 失败并返回 path `agents.<id>.args[<i>]`
- **AND** 错误信息 SHALL 指引改用 `env_passthrough` 声明变量名并把值放进 llmwiki 进程环境

#### Scenario: args 拒绝凭据值形态
- **WHEN** `args` 中某一项含 `Bearer ` 前缀、`Authorization:` 前缀，或以 `sk-`、`ghp_`、`github_pat_`、`xoxb-`、`xoxp-`、`AKIA` 开头，或为 JWT 形态（`eyJ` 开头且含两个 `.`）
- **THEN** 校验 SHALL 失败并返回 path `agents.<id>.args[<i>]`

#### Scenario: args 校验不做自动脱敏
- **WHEN** `args` 命中凭据校验
- **THEN** 系统 SHALL 拒绝整份配置
- **AND** SHALL NOT 对该参数做掩码后继续保存或继续启动进程

#### Scenario: args 正常参数不被误伤
- **WHEN** `args` 为形如 `["-y", "some-acp-adapter", "--acp", "--verbose"]` 的普通启动参数
- **THEN** 校验 SHALL 通过

#### Scenario: 子进程环境为白名单
- **WHEN** 启动 agent 子进程
- **THEN** 子进程环境 SHALL 只包含 `env_passthrough` 中在当前进程环境已存在且允许透传的变量，以及强制保留的 `PATH`
- **AND** llmwiki 进程的其他环境变量 SHALL NOT 被透传
- **AND** SHALL NOT 存在任何来自配置的字面量环境变量值

#### Scenario: env_passthrough 变量未设置时跳过
- **WHEN** `env_passthrough` 声明的某个变量名在 llmwiki 进程环境中不存在
- **THEN** 系统 SHALL 跳过该变量而不报错
- **AND** SHALL NOT 用任何配置来源的值补齐

#### Scenario: API 响应不含环境变量值
- **WHEN** 客户端读取 agent 配置或探活结果
- **THEN** 响应中 SHALL NOT 出现任何环境变量的值
- **AND** `env_passthrough` SHALL 以 `{name, present}` 形态返回，`present` 仅表示该变量名在进程环境中是否已设置

#### Scenario: 日志与调试事件脱敏
- **WHEN** JSON-RPC 报文或 agent stderr 被写入 `session_message_events`、`activity_logs` 或标准日志
- **THEN** 内容 SHALL 先经脱敏（掩盖 `sk-` 前缀密钥、`Bearer <token>`、`ghp_*`、`xox*-*` 等形态）
- **AND** payload SHALL 先经 `ingest.SanitizePayload` 剔除 `api_key` / `authorization` / `x-api-key` 并按上限截断

### Requirement: 工作目录隔离与路径越界防护
ACP agent 的 `cwd` SHALL 是绝对路径，且 SHALL 位于 workspace 根目录之内（含根目录本身）。

#### Scenario: workspace 策略
- **WHEN** `cwd_policy` 为 `workspace`
- **THEN** `cwd` SHALL 为 workspace 根的绝对路径

#### Scenario: session 沙箱策略
- **WHEN** `cwd_policy` 为 `session`
- **THEN** `cwd` SHALL 为 `<workspace>/.llmwiki/cache/acp/sessions/<sessionID>`
- **AND** 该目录 SHALL 以权限 `0700` 创建
- **AND** 该路径 SHALL 位于已被 gitignore 的 `.llmwiki/cache/` 之下，因此 SHALL NOT 被 workspace 备份提交纳入

#### Scenario: 符号链接逃逸被拒绝
- **WHEN** 解析后的 `cwd` 经 `EvalSymlinks` 后不等于 workspace 且不以 workspace 加路径分隔符为前缀
- **THEN** 系统 SHALL 拒绝启动该 agent 并返回越界错误

#### Scenario: sessionID 路径注入被拒绝
- **WHEN** sessionID 含 `..` 或路径分隔符
- **THEN** 系统 SHALL 拒绝解析 cwd

#### Scenario: 不开放 client 文件系统方法
- **WHEN** 声明 client capabilities
- **THEN** `fs.readTextFile`、`fs.writeTextFile`、`terminal` SHALL 全部为 `false`
- **AND** 系统 SHALL NOT 实现 `fs/read_text_file`、`fs/write_text_file` 或任何 `terminal/*` 方法

### Requirement: 权限请求决策矩阵
系统 SHALL 以非交互方式响应 `session/request_permission`，决策仅由 agent 的 `permission` 策略与 `defaults.readonly_only` 决定，默认拒绝未识别的工具类别。

#### Scenario: 只读类别按开关允许
- **WHEN** `toolCall.kind` 为 `read` 且 `permission.allow_read` 为 `true`（`search` 对应 `allow_search`，`fetch` 对应 `allow_fetch`）
- **THEN** 系统 SHALL 选择 `kind` 为 `allow_once` 的选项并回 `{"outcome":{"outcome":"selected","optionId":<id>}}`

#### Scenario: think 类别恒允许
- **WHEN** `toolCall.kind` 为 `think`
- **THEN** 系统 SHALL 允许，无需额外开关

#### Scenario: 写类别需双开关
- **WHEN** `toolCall.kind` 为 `edit`、`delete` 或 `move`
- **THEN** 系统 SHALL 仅在 `permission.allow_write` 为 `true` **且** `defaults.readonly_only` 为 `false` 时允许
- **AND** 否则 SHALL 选择 `reject_once`

#### Scenario: execute 类别需双开关
- **WHEN** `toolCall.kind` 为 `execute`
- **THEN** 系统 SHALL 仅在 `permission.allow_execute` 为 `true` **且** `defaults.readonly_only` 为 `false` 时允许
- **AND** 否则 SHALL 选择 `reject_once`

#### Scenario: 未知类别默认拒绝
- **WHEN** `toolCall.kind` 为 `other`、缺失，或为系统未识别的值
- **THEN** 系统 SHALL 选择 `reject_once`

#### Scenario: 永不选择 always 类选项
- **WHEN** 挑选权限选项
- **THEN** 系统 SHALL NOT 选择 `kind` 为 `allow_always` 或 `reject_always` 的选项
- **AND** 理由 SHALL 是保证策略而非 agent 记忆是唯一权威

#### Scenario: 无匹配选项时取消
- **WHEN** 目标 `kind` 的选项不存在于 `options` 中
- **THEN** 系统 SHALL 回 `{"outcome":{"outcome":"cancelled"}}` 并记录原因 `no_matching_option`

#### Scenario: 取消中的权限请求
- **WHEN** 当前 turn 已被取消而仍收到 `session/request_permission`
- **THEN** 系统 SHALL 一律回 `cancelled` 结果

#### Scenario: 决策可审计
- **WHEN** 系统作出任一权限决策
- **THEN** 系统 SHALL 写入一条 `session_message_events` 事件与一条 category 为 `agent` 的 activity 记录
- **AND** 记录 SHALL 含工具类别、决策结果与理由，SHALL NOT 含凭据

### Requirement: ACP 进程生命周期管理
系统 SHALL 为每个 llmwiki ingest session 维护至多一个 ACP agent 子进程，懒启动、可复用、可清理，且 SHALL NOT 留下孤儿进程。

#### Scenario: 懒启动
- **WHEN** 一个 ACP session 首次发起 turn
- **THEN** 系统 SHALL 启动子进程并完成 `initialize` 与 `session/new`
- **AND** 在没有 turn 发生时 SHALL NOT 启动任何子进程

#### Scenario: 同 session 复用进程
- **WHEN** 同一 session 发起后续 turn 且进程仍存活
- **THEN** 系统 SHALL 复用同一子进程与同一 ACP `sessionId`

#### Scenario: 同 session 串行
- **WHEN** 一个 session 已存在 `stream_status='streaming'` 的 assistant 消息时又收到新 turn 请求
- **THEN** 系统 SHALL 返回 HTTP 409 且 SHALL NOT 启动第二个 turn

#### Scenario: 并发上限
- **WHEN** 活跃 ACP 子进程数已达 `acp_max_concurrent_agents`（默认 4）且新 session 请求启动
- **THEN** 系统 SHALL 返回 HTTP 503 并携带 `Retry-After`
- **AND** SHALL NOT 无界排队

#### Scenario: 进程组终止
- **WHEN** 终止一个 agent 子进程
- **THEN** 系统 SHALL 对整个进程组发送 `SIGTERM`，3 秒后未退出则发送 `SIGKILL`
- **AND** 由 agent 启动器 fork 的孙进程 SHALL 一并被终止

#### Scenario: 崩溃当轮失败
- **WHEN** 子进程在 turn 期间退出或 stdout 关闭
- **THEN** 当前 assistant 消息 SHALL 记为 `failed`
- **AND** 系统 SHALL 把脱敏截断后的 stderr 尾部与退出码写入 `session_message_events`
- **AND** 该 session 的连接 SHALL 从进程池移除

#### Scenario: 崩溃自动重启至多一次
- **WHEN** 崩溃发生在本 turn 产生任何正文 token **之前**
- **THEN** 系统 SHALL 自动重启进程并重试该 turn 一次
- **AND** 若崩溃发生在已产生正文之后 SHALL NOT 自动重试，避免重复输出

#### Scenario: 静默超时
- **WHEN** 距最近一次 `session/update` 的时间超过 `idle_timeout_ms`
- **THEN** 系统 SHALL 发起取消序列并把该 turn 记为失败

#### Scenario: 单轮超时
- **WHEN** 一个 turn 的总耗时超过 `prompt_timeout_ms`
- **THEN** 系统 SHALL 发起取消序列并返回可分类的超时错误

#### Scenario: 用户取消
- **WHEN** HTTP 请求上下文被取消（用户点击停止）
- **THEN** 系统 SHALL 发送 `session/cancel` 通知并等待 `session/prompt` 返回，上限 5 秒
- **AND** 等待期间收到的 `session/update` SHALL 继续被接收与持久化
- **AND** 超时未返回时 SHALL 终止进程组

#### Scenario: session 删除与归档时清理
- **WHEN** session 被删除或归档成功
- **THEN** 系统 SHALL 关闭该 session 对应的 agent 子进程

#### Scenario: 服务关闭时清理
- **WHEN** 服务收到关闭信号并完成 HTTP shutdown
- **THEN** 系统 SHALL 关闭全部 ACP 子进程后再退出

#### Scenario: 进程重启后的历史重建
- **WHEN** 进程重启后创建了新的 ACP session 且 llmwiki 侧已有历史消息
- **THEN** 首个 `session/prompt` SHALL 在真实用户输入之前前置一段由 llmwiki 侧历史渲染的引导文本
- **AND** 系统 SHALL 记录一条标记历史重放的调试事件
- **AND** 系统 SHALL NOT 依赖 `session/resume` 或 `session/load`

### Requirement: ACP agent 可用性探测
系统 SHALL 提供轻量可用性判断与完整探活两种能力，且 SHALL NOT 在 agent 不可用时静默回退到 native。

#### Scenario: 轻量可用性
- **WHEN** 调用 `Availability`
- **THEN** 系统 SHALL 仅通过 `exec.LookPath` 判断命令是否可用，SHALL NOT 启动子进程
- **AND** SHALL 返回 `{available, reason}`

#### Scenario: 完整探活状态集
- **WHEN** 调用 `CheckAgents`
- **THEN** 每个 agent 的 `status` SHALL 为 `ok`、`error` 或 `disabled` 之一
- **AND** `ok` 时 SHALL 附带 `agent_name`、`agent_version`、`protocol_version`

#### Scenario: CLI 未安装
- **WHEN** agent 的 `command` 在 PATH 中不存在
- **THEN** `status` SHALL 为 `error` 且 `code` SHALL 为 `cli_not_found`
- **AND** 消息 SHALL 指出缺失的命令名

#### Scenario: 探活进程即用即弃
- **WHEN** 探活完成
- **THEN** 探活所启动的子进程 SHALL 被立即终止
- **AND** SHALL NOT 进入会话进程池

#### Scenario: 不可用时明确失败
- **WHEN** session 的 runtime 为 ACP 但 agent 不可用
- **THEN** 系统 SHALL 返回明确错误并阻止发送
- **AND** SHALL NOT 改用 native runtime 生成回复
