### Requirement: Session 级别 Provider/Model 选择器
UI SHALL 在每个聊天 session 中通过“按钮 + 模态框”提供 Provider 和 Model 联动选择器。选择入口 SHALL 位于发送操作附近，并避免占用顶部固定栏位。

#### Scenario: 通过入口按钮打开选择器
- **WHEN** 用户在聊天输入区点击模型选择按钮
- **THEN** UI SHALL 打开 Provider/Model 选择模态框

#### Scenario: Provider 联动 Model
- **WHEN** 用户在模态框中切换 Provider 实例
- **THEN** Model 列表 SHALL 自动加载该实例对应 catalog provider 的模型（来自 `GET /api/v1/providers/{catalog_id}/models`）

#### Scenario: 选择确认
- **WHEN** 用户在模态框中确认 provider/model 组合
- **THEN** UI SHALL 调用 `PATCH /api/v1/ingest/sessions/{id}` 保存选择到后端

#### Scenario: 显示当前选择
- **WHEN** session 已有 provider/model 配置
- **THEN** 聊天输入区附近 SHALL 以灰色状态标识显示当前 provider 和 model

### Requirement: 输入框守卫
UI SHALL 在 provider/model 未配置或 API Key 缺失时禁用消息输入框。

#### Scenario: 三个条件全部满足
- **WHEN** session 有 provider 且有 model 且该 provider 已配置 API Key
- **THEN** 输入框 SHALL 处于启用状态

#### Scenario: 缺少 provider 或 model
- **WHEN** session 未配置 provider 或未配置 model
- **THEN** 输入框 SHALL 禁用，并显示提示“请先选择 Provider 和 Model”

#### Scenario: 缺少 API Key
- **WHEN** session 已配置 provider 和 model，但该 provider 未配置 API Key
- **THEN** 输入框 SHALL 禁用，并显示提示“[Provider Name] API Key 未配置，请在 Settings 中添加”

### Requirement: 最近使用继承
新建 session 时，UI SHALL 自动填入最近使用的 provider 和 model。

#### Scenario: 有最近使用记录
- **WHEN** 用户创建新 session 且 `app_config` 中有 `last_provider` 和 `last_model`
- **THEN** 新 session 的选择器 SHALL 自动选中该 provider 和 model，并通过 `POST /api/v1/ingest/sessions` 传入

#### Scenario: 无最近使用记录
- **WHEN** 用户创建新 session 且 `app_config` 中无 `last_provider`
- **THEN** 新 session 的选择器 SHALL 显示为空，输入框禁用
