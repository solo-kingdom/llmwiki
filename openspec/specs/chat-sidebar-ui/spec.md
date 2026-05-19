### Requirement: 多 Session 侧边栏
UI SHALL 支持创建、切换和管理多个聊天 session。默认交互入口 SHALL 采用轻量操作模式：提供“切换 session”按钮和“新建 session”按钮；系统 MAY 在部分布局下提供可选侧边栏扩展视图，但不应要求用户依赖持久宽侧栏完成核心会话操作。

#### Scenario: 显示 session 切换入口
- **WHEN** 用户打开 Ingest 页面
- **THEN** 聊天区域 SHALL 提供可见的 session 切换入口和新建入口

#### Scenario: 创建新 session
- **WHEN** 用户点击“新建 session”按钮
- **THEN** UI SHALL 调用 `POST /api/v1/ingest/sessions` 创建新 session（传入最近使用的 provider/model），并切换到该 session

#### Scenario: 切换 session
- **WHEN** 用户通过切换入口选择某个 session
- **THEN** UI SHALL 加载该 session 的消息历史并切换到对应聊天视图

#### Scenario: 当前 session 高亮
- **WHEN** 某个 session 处于活跃状态
- **THEN** session 选择列表中该项 SHALL 有视觉高亮标识

#### Scenario: 归档后的 session
- **WHEN** session 被归档
- **THEN** 该 session SHALL 在切换列表中显示为“已归档”状态，并不可继续发送消息
