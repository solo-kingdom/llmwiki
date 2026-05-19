## ADDED Requirements

### Requirement: Chat-first Ingest layout with sidebar
Ingest 页面 SHALL 在左侧显示 session 侧边栏，右侧显示当前 session 的聊天界面。

#### Scenario: 整体布局
- **WHEN** 用户打开 Ingest tab
- **THEN** 页面 SHALL 左侧显示 `ChatSidebar` 组件、右侧显示当前 session 的 `IngestChat` 组件（含 provider/model 选择器）

#### Scenario: 无活跃 session
- **WHEN** 没有任何 session 或所有 session 都已归档
- **THEN** 右侧 SHALL 显示欢迎界面和"新建对话"按钮

### Requirement: Settings 页面 per-provider Key 管理
Settings 页面 SHALL 支持按 provider 独立管理 API Key。

#### Scenario: Provider Key 列表
- **WHEN** 用户打开 Settings 页面
- **THEN** LLM Configuration 区域 SHALL 显示 provider 列表，每个 provider 显示名称、当前 Key 状态（已配置/未配置）、以及 Key 输入框

#### Scenario: 输入 API Key
- **WHEN** 用户在某 provider 行输入 API Key 并保存
- **THEN** UI SHALL 调用 `PUT /api/v1/settings/provider-keys/{provider_id}` 保存

#### Scenario: 删除 API Key
- **WHEN** 用户清空某 provider 的 API Key 输入框并保存
- **THEN** UI SHALL 发送空字符串删除该 Key

### Requirement: Archive 后自动创建新 session
归档当前 session 后，UI SHALL 自动创建新 session 并切换到它。

#### Scenario: 归档后新建
- **WHEN** 用户成功归档一个 session
- **THEN** UI SHALL 自动创建新 session（继承最近使用的 provider/model），清空聊天区域，侧边栏更新列表
