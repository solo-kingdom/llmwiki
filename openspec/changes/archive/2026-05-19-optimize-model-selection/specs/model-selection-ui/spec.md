## ADDED Requirements

### Requirement: Session 级别 Provider/Model 选择器
UI SHALL 在每个聊天 session 的顶部提供 Provider 和 Model 联动下拉选择器。

#### Scenario: Provider 下拉
- **WHEN** 用户打开某个聊天 session
- **THEN** 顶部 SHALL 显示 Provider 下拉列表，列出所有可用 provider（来自 `GET /api/v1/providers`）

#### Scenario: Provider 联动 Model
- **WHEN** 用户切换 Provider 下拉选择
- **THEN** Model 下拉 SHALL 自动加载新选中 provider 的 model 列表（来自 `GET /api/v1/providers/{id}/models`）

#### Scenario: 选择确认
- **WHEN** 用户确认 provider/model 选择（通过下拉变更或失焦）
- **THEN** UI SHALL 调用 `PATCH /api/v1/ingest/sessions/{id}` 保存选择到后端

#### Scenario: 显示当前选择
- **WHEN** session 已有 provider/model 配置
- **THEN** 选择器 SHALL 显示当前值（从 session 数据中读取）

### Requirement: 输入框守卫
UI SHALL 在 provider/model 未配置或 API Key 缺失时禁用消息输入框。

#### Scenario: 三个条件全部满足
- **WHEN** session 有 provider 且有 model 且该 provider 已配置 API Key
- **THEN** 输入框 SHALL 处于启用状态

#### Scenario: 缺少 provider 或 model
- **WHEN** session 未配置 provider 或未配置 model
- **THEN** 输入框 SHALL 禁用，并显示提示"请先选择 Provider 和 Model"

#### Scenario: 缺少 API Key
- **WHEN** session 已配置 provider 和 model，但该 provider 未配置 API Key
- **THEN** 输入框 SHALL 禁用，并显示提示"[Provider Name] API Key 未配置，请在 Settings 中添加"

#### Scenario: Provider 未配 Key 警告标识
- **WHEN** provider 下拉中某个 provider 未配置 API Key
- **THEN** 该 provider 选项 SHALL 显示警告标识（如 ⚠️ 或 badge）

### Requirement: 最近使用继承
新建 session 时，UI SHALL 自动填入最近使用的 provider 和 model。

#### Scenario: 有最近使用记录
- **WHEN** 用户创建新 session 且 `app_config` 中有 `last_provider` 和 `last_model`
- **THEN** 新 session 的选择器 SHALL 自动选中该 provider 和 model，并通过 `POST /api/v1/ingest/sessions` 传入

#### Scenario: 无最近使用记录
- **WHEN** 用户创建新 session 且 `app_config` 中无 `last_provider`
- **THEN** 新 session 的选择器 SHALL 显示为空，输入框禁用
