## ADDED Requirements

### Requirement: 多 Session 侧边栏
UI SHALL 在 Ingest tab 左侧显示 session 列表侧边栏，支持创建、切换和管理多个聊天 session。

#### Scenario: 显示 session 列表
- **WHEN** 用户打开 Ingest tab
- **THEN** 左侧 SHALL 显示侧边栏，列出所有 session（按 `updated_at` 降序），每项显示标题和 provider 图标/名称

#### Scenario: 创建新 session
- **WHEN** 用户点击侧边栏顶部的"新建对话"按钮
- **THEN** UI SHALL 调用 `POST /api/v1/ingest/sessions` 创建新 session（传入最近使用的 provider/model），并切换到该 session

#### Scenario: 切换 session
- **WHEN** 用户点击侧边栏中的某个 session
- **THEN** UI SHALL 加载该 session 的消息历史并切换到该 session 的聊天视图

#### Scenario: 当前 session 高亮
- **WHEN** 某个 session 处于活跃状态
- **THEN** 侧边栏中该项 SHALL 有视觉高亮标识

#### Scenario: 归档后的 session
- **WHEN** session 被归档
- **THEN** 该 session SHALL 在侧边栏中显示为"已归档"状态（如灰色文字或锁定图标），不可再发送消息

#### Scenario: 侧边栏可折叠
- **WHEN** 用户需要更多聊天区域空间
- **THEN** 侧边栏 SHALL 支持折叠/展开切换

### Requirement: Session 标题显示
侧边栏中每个 session SHALL 显示有意义的标题。

#### Scenario: 有标题
- **WHEN** session 有用户设置或自动生成的标题
- **THEN** 侧边栏 SHALL 显示该标题

#### Scenario: 无标题
- **WHEN** session 无标题
- **THEN** 侧边栏 SHALL 显示"新对话"或截取首条消息前 20 字符作为预览

#### Scenario: 显示 provider 信息
- **WHEN** session 有配置 provider
- **THEN** 侧边栏项 SHALL 显示 provider 名称或缩写标识
