## ADDED Requirements

### Requirement: Provider 实例数据模型
系统 SHALL 维护 `provider_instances` 表，每条记录代表一个用户主动添加的 Provider 配置实例，包含 id（`inst_` 前缀短 ID）、name（用户自定义名称）、catalog_id（指向 provider catalog）、api_key、base_url、时间戳。

#### Scenario: 创建实例
- **WHEN** 用户提交添加表单（选择 catalog provider、输入名称、输入 API key）
- **THEN** 系统 SHALL 生成 `inst_` 前缀 ID，将实例存入 `provider_instances` 表并返回完整实例信息

#### Scenario: 实例 ID 格式
- **WHEN** 创建新实例
- **THEN** ID SHALL 为 `inst_` + 8 位十六进制字符（UUID 前 8 位）

#### Scenario: 同一 catalog provider 多实例
- **WHEN** 用户添加多个实例指向同一 catalog_id（如两个 OpenAI 实例）
- **THEN** 系统 SHALL 允许此操作，每个实例有独立的 ID、名称、key

### Requirement: Provider 实例 CRUD API
系统 SHALL 提供 RESTful API 管理实例：`POST/GET/PUT/DELETE /api/v1/provider-instances[/{id}]`。

#### Scenario: 创建实例
- **WHEN** `POST /api/v1/provider-instances` 提供 name、catalog_id、api_key、base_url
- **THEN** 系统 SHALL 创建实例并返回 201 及完整实例对象

#### Scenario: 列出实例
- **WHEN** `GET /api/v1/provider-instances`
- **THEN** 系统 SHALL 返回所有实例列表，按创建时间排序

#### Scenario: 更新实例
- **WHEN** `PUT /api/v1/provider-instances/{id}` 提供部分或全部字段
- **THEN** 系统 SHALL 更新指定字段并返回更新后的实例

#### Scenario: 更新实例允许改类型
- **WHEN** 用户修改实例的 catalog_id（如从 openai 改为 anthropic）
- **THEN** 系统 SHALL 允许此变更，且 SHALL NOT 清空或修改 api_key 和 base_url 字段

#### Scenario: 删除实例
- **WHEN** `DELETE /api/v1/provider-instances/{id}`
- **THEN** 系统 SHALL 删除该实例，即使有 session 正在使用它

#### Scenario: 删除不存在的实例
- **WHEN** 删除一个不存在的实例 ID
- **THEN** 系统 SHALL 返回 404

### Requirement: Settings 页面 Provider 实例管理 UI
Settings 页面 SHALL 展示已添加的 Provider 实例列表，支持通过 inline 表单添加、编辑和删除实例。

#### Scenario: 实例列表展示
- **WHEN** 用户打开 Settings 页面
- **THEN** 页面 SHALL 展示所有已添加的 Provider 实例，每项显示名称、masked key（如有）、编辑和删除按钮

#### Scenario: 空状态
- **WHEN** 尚未添加任何实例
- **THEN** 页面 SHALL 显示引导文案"还没有添加任何 Provider"

#### Scenario: 添加实例表单
- **WHEN** 用户点击 [+ 添加] 按钮
- **THEN** 页面 SHALL 展开 inline 表单，包含：Provider 类型下拉（来自 catalog）、名称输入（预填所选 provider 的 display name）、API Key 输入、Base URL 输入（可选）、确认和取消按钮

#### Scenario: 添加实例名称默认值
- **WHEN** 用户在添加表单中选择 Provider 类型
- **THEN** 名称输入框 SHALL 自动填充所选 provider 的 display name，用户可修改

#### Scenario: 编辑实例
- **WHEN** 用户点击某实例的编辑按钮
- **THEN** 页面 SHALL 展开编辑表单，预填当前实例的名称、类型、masked key 提示、base URL

#### Scenario: 编辑时修改类型
- **WHEN** 用户在编辑表单中更改 Provider 类型
- **THEN** 表单 SHALL 显示警告"更改类型后，当前选定的模型将被重置"，且 SHALL NOT 清空 API Key 字段

#### Scenario: 删除实例
- **WHEN** 用户点击某实例的删除按钮并确认
- **THEN** 实例 SHALL 从列表中移除，如有 session 使用该实例则下次打开需重新选择
