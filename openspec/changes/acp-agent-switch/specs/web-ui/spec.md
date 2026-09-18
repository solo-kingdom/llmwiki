## MODIFIED Requirements

### Requirement: Settings page information architecture
The Settings page SHALL organize configuration controls into user-oriented groups rather than one undifferentiated long form. The grouping SHALL distinguish common settings, model/provider connection settings, workspace rule and MCP settings, automation/capacity settings, and version control status. Agent runtime configuration (default runtime and ACP agent definitions) SHALL live in the model/provider connection group, because it selects which engine answers chat rather than which pages are produced.

#### Scenario: Settings page shows grouped sections
- **WHEN** user opens Settings in the management workbench
- **THEN** the page SHALL present clearly labeled setting groups for common settings, model/provider connection settings, workspace rule and MCP settings, automation/capacity settings, and version control status
- **AND** each group SHALL provide enough descriptive text for users to understand the purpose of the settings inside it

#### Scenario: Advanced settings have lower default visual priority
- **WHEN** user opens Settings
- **THEN** low-frequency or expert-oriented controls such as MCP JSON, processing parameters, log retention limits, and tool loop limits SHALL be visually separated from common settings
- **AND** the UI SHALL keep those controls discoverable without presenting them as the first task on the page

#### Scenario: ACP agent settings live with model connection settings
- **WHEN** user opens Settings
- **THEN** the ACP Agents card SHALL appear inside the model/provider connection group alongside Provider instance management
- **AND** the group description SHALL indicate that it covers both provider instances and agent runtimes

## ADDED Requirements

### Requirement: ACP Agents 管理卡片
Settings 页面 SHALL 提供 ACP Agents 管理卡片，用于选择默认 agent runtime、编辑 `acp_agents_json` 并探测连通性。该卡片的交互形态 SHALL 与既有 MCP 服务器卡片一致（JSON 文本域 + 独立的检查按钮 + 结果列表）。

#### Scenario: 默认 runtime 选择
- **WHEN** 用户在 ACP Agents 卡片中切换默认 agent runtime
- **THEN** UI SHALL 通过 `PUT /api/v1/settings` 写入 `default_agent_kind`
- **AND** 选择 `acp` 时 SHALL 同时要求选择一个默认 agent 并写入 `default_acp_agent_id`

#### Scenario: JSON 配置编辑与保存
- **WHEN** 用户编辑 `acp_agents_json` 文本域
- **THEN** UI SHALL 标记存在未保存变更
- **AND** 保存 SHALL 通过页面级 save 动作提交，而非卡片内的独立保存按钮

#### Scenario: 检查连接为局部动作
- **WHEN** 用户点击「检查连接」
- **THEN** UI SHALL 调用 `POST /api/v1/acp-agents/check` 并传入当前文本域内容（含未保存变更）
- **AND** 该动作 SHALL 呈现为与页面级 Settings 保存动作视觉区分的局部操作

#### Scenario: 探测结果三态展示
- **WHEN** 探测返回结果
- **THEN** 每个 agent SHALL 显示 `ok`、`error` 或 `disabled` 状态
- **AND** `ok` SHALL 展示 agent 名称、版本与协议版本
- **AND** `error` SHALL 展示可读的失败原因

#### Scenario: 配置错误定位
- **WHEN** 配置校验失败
- **THEN** UI SHALL 展示错误信息与出错字段的 JSON path

#### Scenario: 环境变量只显示名称与状态
- **WHEN** 卡片展示某 agent 的 `env_passthrough`
- **THEN** UI SHALL 只显示变量名与「已设置 / 未设置」状态
- **AND** SHALL NOT 显示或提供任何变量值的输入框

#### Scenario: 写权限告警
- **WHEN** 配置中 `defaults.readonly_only` 为 `false`
- **THEN** 卡片 SHALL 显示告警文案，说明 agent 可在 workspace 内直接改写文件

### Requirement: Agent runtime 选择器
聊天界面 SHALL 允许用户在 session 级别选择 agent runtime（native 或某个 ACP agent）。选择入口 SHALL 复用既有的模型选择模态框，避免新增顶部固定栏位。

#### Scenario: 模态框顶部提供 runtime 切换
- **WHEN** 用户打开模型选择模态框
- **THEN** 模态框顶部 SHALL 提供 agent runtime 选择控件，选项为 `native` 与每个已启用的 ACP agent

#### Scenario: 选择 native 保留原有联动
- **WHEN** 用户选择 `native`
- **THEN** Provider 实例与 Model 两个下拉 SHALL 保持可用且维持既有联动行为

#### Scenario: 选择 ACP 时禁用而非隐藏模型选择
- **WHEN** 用户选择某个 ACP agent
- **THEN** Provider 实例与 Model 下拉 SHALL 被禁用并显示「由 agent 自行选择模型」的说明
- **AND** 这两个下拉 SHALL 保持可见，以便切回 `native` 时仍能查看与修改

#### Scenario: 确认后持久化到后端
- **WHEN** 用户确认 runtime 选择
- **THEN** UI SHALL 调用 `PATCH /api/v1/ingest/sessions/{id}` 提交 `agent_kind` 与 `acp_agent_id`

#### Scenario: 不可用 agent 显示原因
- **WHEN** 某个 ACP agent 的 `available` 为 false
- **THEN** 该选项 SHALL 显示不可用原因（如命令未找到）

#### Scenario: 当前 runtime 可见
- **WHEN** session 已选择 runtime
- **THEN** 聊天输入区附近 SHALL 显示当前 runtime：ACP 模式显示 agent 名称与 ACP 标识，native 模式显示 provider 实例名与 model

### Requirement: Runtime 感知的聊天输入守卫
聊天输入框的启用条件 SHALL 依据 session 的 agent runtime 分支判定。对 `acp` session，该规则 SHALL 优先于 `model-selection-ui` 中基于 provider/model/API Key 的通用守卫。

#### Scenario: native 守卫保持不变
- **WHEN** session 的 runtime 为 `native`
- **THEN** 输入框 SHALL 仅在已选 Provider 实例且已选 Model 时启用
- **AND** 缺失时的提示文案 SHALL 与既有行为一致

#### Scenario: ACP 就绪时启用输入
- **WHEN** session 的 runtime 为 `acp`，已选 agent 且该 agent `enabled` 与 `available` 均为 true
- **THEN** 输入框 SHALL 启用
- **AND** 即使系统中不存在任何 Provider 实例，输入框仍 SHALL 启用

#### Scenario: ACP 不得因缺少 API Key 被误禁用
- **WHEN** session 的 runtime 为 `acp`
- **THEN** UI SHALL NOT 因 provider 实例缺失或 API Key 未配置而禁用输入框
- **AND** SHALL NOT 显示与 Provider API Key 相关的提示

#### Scenario: ACP 未就绪时分因禁用
- **WHEN** session 的 runtime 为 `acp` 但未就绪
- **THEN** 输入框 SHALL 禁用
- **AND** 提示文案 SHALL 区分「未配置任何 ACP Agent」「未选择 Agent」「Agent 已禁用」「命令未找到」四种原因

### Requirement: ACP 流式内容展示
聊天消息 SHALL 展示 ACP turn 特有的思考与计划内容，且这些内容 SHALL 与正文视觉区分。

#### Scenario: 思考内容折叠展示
- **WHEN** 消息收到 `thought` 事件内容
- **THEN** UI SHALL 以可折叠区域展示，默认收起
- **AND** SHALL NOT 与 assistant 正文混排

#### Scenario: 计划列表展示
- **WHEN** 消息收到 `plan` 事件
- **THEN** UI SHALL 以有序列表展示条目内容与状态

#### Scenario: 权限决策行内提示
- **WHEN** 消息收到 `permission` 事件
- **THEN** UI SHALL 以行内状态文案展示被允许或被拒绝的工具类别

#### Scenario: 未知事件不破坏渲染
- **WHEN** 流中出现 UI 未识别的事件名
- **THEN** UI SHALL 忽略该事件
- **AND** 正文流与最终消息状态 SHALL 不受影响

#### Scenario: 刷新后可回看
- **WHEN** 用户刷新页面后打开该消息的调试对话框
- **THEN** thought、tool call、plan、权限决策与 stop reason SHALL 可从 `GET /api/v1/ingest/sessions/{id}/messages/{messageId}/events` 读取并展示

### Requirement: Session 列表显示 agent runtime
Session 切换列表 SHALL 显示每个 session 使用的 agent runtime，使用户在切换前即可判断。

#### Scenario: ACP session 标识
- **WHEN** 某 session 的 `agent_kind` 为 `acp`
- **THEN** 列表项副标题 SHALL 显示 `ACP` 标识与 agent 名称

#### Scenario: native session 标识
- **WHEN** 某 session 的 `agent_kind` 为 `native`
- **THEN** 列表项副标题 SHALL 保持显示 provider 实例名与 model

#### Scenario: 新建 session 继承默认 runtime
- **WHEN** 用户点击「新建 session」
- **THEN** UI SHALL 把 `default_agent_kind` 与 `default_acp_agent_id` 一并传给 `POST /api/v1/ingest/sessions`
