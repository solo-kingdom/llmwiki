## ADDED Requirements

### Requirement: ACP agent 相关配置键
Settings API SHALL 支持读写 `acp_agents_json`、`default_agent_kind`、`default_acp_agent_id` 与 `acp_max_concurrent_agents`。

#### Scenario: GET settings 包含 ACP 键
- **WHEN** 客户端请求 `GET /api/v1/settings`
- **THEN** 响应 SHALL 包含 `acp_agents_json`，未设置时 SHALL 返回默认空配置的规范化 JSON（`version: 1`、空 `agents`、默认 `defaults`）
- **AND** SHALL 包含 `default_agent_kind`，未设置或非法时 SHALL 返回 `"native"`
- **AND** SHALL 包含 `default_acp_agent_id`，未设置时 SHALL 返回空字符串
- **AND** SHALL 包含 `acp_max_concurrent_agents`，未设置时 SHALL 返回默认值 `"4"`

#### Scenario: PUT acp_agents_json 规范化落库
- **WHEN** 客户端 PUT 合法的 `acp_agents_json`
- **THEN** 系统 SHALL 校验后以规范化 JSON 写入 `app_config`
- **AND** 后续 GET SHALL 返回同一规范化字符串

#### Scenario: PUT acp_agents_json 非法返回 path
- **WHEN** 客户端 PUT 的 `acp_agents_json` 校验失败
- **THEN** 系统 SHALL 返回 HTTP 400
- **AND** 错误信息 SHALL 含出错字段的 JSON path（如 `agents.my-agent.cwd_policy`）
- **AND** SHALL NOT 写入 `app_config`

#### Scenario: PUT 含环境变量值字段被拒
- **WHEN** 客户端 PUT 的 `acp_agents_json` 中某 agent 出现 `env` 键
- **THEN** 系统 SHALL 返回 HTTP 400，错误信息含 path `agents.<id>.env` 并指引改用 `env_passthrough` 只声明变量名
- **AND** SHALL NOT 写入 `app_config`
- **AND** SHALL NOT 静默丢弃该字段后保存

#### Scenario: PUT 的 args 夹带凭据被拒
- **WHEN** 客户端 PUT 的 `acp_agents_json` 中某 agent 的 `args` 含凭据参数名（如 `--api-key`、`--token`、`--header`）或凭据值形态（如 `sk-...`、`ghp_...`、`Bearer ...`、JWT）
- **THEN** 系统 SHALL 返回 HTTP 400，错误信息含 path `agents.<id>.args[<i>]`
- **AND** 错误信息 SHALL 指引改用 `env_passthrough` 声明变量名并把值放进 llmwiki 进程环境
- **AND** SHALL NOT 写入 `app_config`

#### Scenario: PUT 的 env_passthrough 可声明凭据变量名
- **WHEN** 客户端 PUT 的某 agent 的 `env_passthrough` 含形如 `SOME_PROVIDER_API_KEY`、`GITHUB_TOKEN` 的变量名
- **THEN** 系统 SHALL 校验通过并写入 `app_config`
- **AND** SHALL NOT 因名称疑似凭据而拒绝

#### Scenario: PUT 的 env_passthrough 名称非法被拒
- **WHEN** 客户端 PUT 的某 agent 的 `env_passthrough` 含不合法的环境变量名、空串或重复项
- **THEN** 系统 SHALL 返回 HTTP 400，错误信息含 path `agents.<id>.env_passthrough[<i>]`

#### Scenario: PUT default_agent_kind
- **WHEN** 客户端 PUT `default_agent_kind` 为 `native` 或 `acp`
- **THEN** 系统 SHALL 写入 `app_config`

#### Scenario: PUT default_agent_kind 非法
- **WHEN** 客户端 PUT `default_agent_kind` 为其他值
- **THEN** 系统 SHALL 返回 HTTP 400

#### Scenario: PUT default_acp_agent_id 必须存在
- **WHEN** 客户端 PUT 非空 `default_acp_agent_id`
- **THEN** 系统 SHALL 校验该 id 存在于当前生效的 `acp_agents_json`（含同一请求中提交的新配置）
- **AND** 不存在时 SHALL 返回 HTTP 400

#### Scenario: PUT acp_max_concurrent_agents 边界
- **WHEN** 客户端 PUT `acp_max_concurrent_agents` 不在 1–16 范围内或非整数
- **THEN** 系统 SHALL 返回 HTTP 400

#### Scenario: ACP 设置不含凭据值
- **WHEN** 客户端读取 `GET /api/v1/settings`
- **THEN** `acp_agents_json` 中 SHALL NOT 出现任何环境变量值
- **AND** 由于配置模型本身不含存放环境变量值的字段，系统 SHALL NOT 需要对该键做掩码处理

#### Scenario: 保存后仍触发导出与备份
- **WHEN** 客户端 PUT `/api/v1/settings` 且包含 ACP 键并成功
- **THEN** 系统 SHALL 按既有流程导出 `workspace-settings.json` 并尝试备份提交

### Requirement: ACP agent 列表 API
系统 SHALL 暴露 `GET /api/v1/acp-agents`，返回脱敏后的 agent 配置与轻量可用性判断。

#### Scenario: 返回 agent 列表
- **WHEN** 客户端请求 `GET /api/v1/acp-agents`
- **THEN** 响应 SHALL 为 `{"agents": [{id, name, enabled, command, args, cwd_policy, permission, env_passthrough, available, unavailable_reason}, ...]}`

#### Scenario: 空配置返回空列表
- **WHEN** `acp_agents_json` 未设置
- **THEN** 响应 SHALL 为 `{"agents": []}` 且 HTTP 200

#### Scenario: env_passthrough 只回变量名与状态
- **WHEN** 某 agent 声明了 `env_passthrough`
- **THEN** 响应中该字段 SHALL 为 `[{"name": <变量名>, "present": <布尔>}, ...]`
- **AND** SHALL NOT 包含任何变量值

#### Scenario: 响应不含任何环境变量值
- **WHEN** 客户端读取该端点
- **THEN** 响应 SHALL NOT 包含任何环境变量的值
- **AND** SHALL NOT 包含任何用于存放环境变量值的字段

#### Scenario: 轻量可用性不启动进程
- **WHEN** 处理该请求
- **THEN** 系统 SHALL 仅通过 `exec.LookPath` 判断可用性
- **AND** SHALL NOT 启动任何 agent 子进程

#### Scenario: 配置非法不打死页面
- **WHEN** 存储的 `acp_agents_json` 无法解析
- **THEN** 系统 SHALL 返回 HTTP 200，`agents` 为空数组
- **AND** SHALL 附带 `config_error` 字段说明错误与 JSON path

### Requirement: ACP agent 探活 API
系统 SHALL 暴露 `POST /api/v1/acp-agents/check`，对每个 agent 执行连接探测并返回状态。

#### Scenario: 探测已保存配置
- **WHEN** 客户端 POST 空 body
- **THEN** 系统 SHALL 读取 `app_config` 的 `acp_agents_json` 进行探测

#### Scenario: 探测未保存配置
- **WHEN** 客户端 POST body 含 `{"acp_agents_json": "..."}`
- **THEN** 系统 SHALL 使用该 JSON 而非数据库中的值进行探测

#### Scenario: 探测结果状态集
- **WHEN** 探测完成
- **THEN** 每个条目 SHALL 含 `{id, name, enabled, status}`，`status` SHALL 为 `ok`、`error` 或 `disabled`
- **AND** `status` 为 `ok` 时 SHALL 含 `agent_name`、`agent_version`、`protocol_version`
- **AND** `status` 为 `error` 时 SHALL 含 `code` 与 `message`

#### Scenario: 禁用的 agent
- **WHEN** agent 的 `enabled` 为 false
- **THEN** `status` SHALL 为 `disabled` 且 SHALL NOT 启动子进程

#### Scenario: 命令未找到
- **WHEN** agent 的 `command` 在 PATH 中不存在
- **THEN** `status` SHALL 为 `error`，`code` SHALL 为 `cli_not_found`

#### Scenario: 协议版本不支持
- **WHEN** agent 的 `initialize` 响应中 `protocolVersion` 不等于 1
- **THEN** `status` SHALL 为 `error`，`code` SHALL 为 `protocol_version_unsupported`

#### Scenario: 探测配置非法
- **WHEN** 传入或存储的配置无法解析，或命中凭据边界校验
- **THEN** 系统 SHALL 返回 HTTP 400 且错误信息含 JSON path

#### Scenario: 探测不污染会话进程池
- **WHEN** 探测启动了子进程
- **THEN** 该进程 SHALL 在探测结束后被终止
- **AND** SHALL NOT 被后续会话复用

### Requirement: Health 端点暴露 ACP 启用状态
`GET /api/v1/health` 的 `mode` 对象 SHALL 包含 `acp_enabled`，用于部署后无需登录 UI 即可验证 ACP 配置状态。

#### Scenario: 未配置 ACP
- **WHEN** `acp_agents_json` 为空或不含任何 `enabled` 为 true 的 agent
- **THEN** `mode.acp_enabled` SHALL 为 `false`

#### Scenario: 已配置启用的 ACP agent
- **WHEN** 配置可解析且至少一个 agent 的 `enabled` 为 true
- **THEN** `mode.acp_enabled` SHALL 为 `true`

#### Scenario: 配置非法
- **WHEN** `acp_agents_json` 无法解析
- **THEN** `mode.acp_enabled` SHALL 为 `false`
- **AND** health 端点 SHALL 仍返回 HTTP 200
