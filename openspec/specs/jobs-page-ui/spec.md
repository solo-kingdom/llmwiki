## ADDED Requirements

### Requirement: 独立 Jobs 全局页面
系统 SHALL 在全局导航中提供独立的 Jobs 页面，展示所有摄入任务列表，与 Ingest 页面分离。Jobs 页面内容容器 SHALL 使用居中布局并采用与 Settings 页面一致的内容宽度策略，避免全宽拉伸。

#### Scenario: 导航到 Jobs 页面
- **WHEN** 用户点击全局导航的 Jobs 入口
- **THEN** 系统 SHALL 展示独立的 Jobs 页面，包含状态筛选区域和任务列表

#### Scenario: 与 Settings 页面宽度一致
- **WHEN** 用户分别查看 Jobs 页面和 Settings 页面
- **THEN** 两个页面的主内容容器 SHALL 使用一致的最大宽度与水平居中对齐

#### Scenario: 无任务空状态
- **WHEN** Jobs 页面打开且无任何摄入任务
- **THEN** 页面 SHALL 显示空状态提示"暂无摄入任务"

### Requirement: 状态筛选 Tab
Jobs 页面顶部 SHALL 提供状态筛选（All / Queued / Running / Succeeded / Failed / Cancelled），每项显示对应任务数量。

#### Scenario: 默认显示全部
- **WHEN** 用户进入 Jobs 页面
- **THEN** 默认选中 "All"，显示所有状态任务

#### Scenario: 按状态筛选
- **WHEN** 用户点击某个状态筛选项（如 "Failed"）
- **THEN** 任务列表 SHALL 仅显示该状态任务

#### Scenario: 状态计数自动更新
- **WHEN** 后台轮询刷新 ingestJobs 数据
- **THEN** 状态筛选项的计数 SHALL 自动更新

### Requirement: Job 卡片列表
每个摄入任务 SHALL 以卡片形式展示，包含来源路径、输入类型、创建时间、状态标签和操作按钮。来源路径对支持预览的文件格式可点击。cancelled 状态增加 Restart 操作按钮。对于 `source_ref` 以 `review:` 开头的 job，SHALL 按 `source_ref` 分组为聚合卡片展示（详见 job-list-grouping-ui spec），其余 job 保持平铺 JobCard 展示。

#### Scenario: 任务卡片基本展示
- **WHEN** 一个任务以平铺 JobCard 形式显示在列表中
- **THEN** 卡片 SHALL 展示来源路径（`source_path`）、输入类型（`input_type`）、创建时间（`created_at`）和状态标签

#### Scenario: 来源路径可点击预览
- **WHEN** 任务的 `source_path` 后缀为 `.md`、`.txt` 或图片格式
- **THEN** `source_path` SHALL 显示为可点击链接样式，点击后打开文件预览模态框

#### Scenario: 来源路径不可预览
- **WHEN** 任务的 `source_path` 后缀不属于支持的预览格式
- **THEN** `source_path` SHALL 保持纯文本展示，不可点击

#### Scenario: 失败任务显示错误信息
- **WHEN** 任务状态为 failed 且有 `error_message` 或 `remediation`
- **THEN** 卡片 SHALL inline 显示错误信息和修复建议

#### Scenario: 失败任务显示重试按钮
- **WHEN** 任务状态为 failed
- **THEN** 卡片右侧 SHALL 显示"Retry"操作按钮

#### Scenario: 已取消任务显示重启按钮
- **WHEN** 任务状态为 cancelled
- **THEN** 卡片右侧 SHALL 显示"Restart"操作按钮，点击后创建新的 retry job

#### Scenario: 进行中任务显示取消按钮
- **WHEN** 任务状态为 queued 或 running
- **THEN** 卡片右侧 SHALL 显示"Cancel"操作按钮

#### Scenario: 状态标签样式
- **WHEN** 任务状态为 succeeded / failed / running / queued / cancelled
- **THEN** 状态标签 SHALL 使用对应语义颜色（succeeded=绿、failed=红、running=蓝、queued/cancelled=灰色）

#### Scenario: Review 类型 job 使用分组卡片
- **WHEN** 任务的 `source_ref` 以 `review:` 开头
- **THEN** 该任务 SHALL 被归入对应的分组卡片展示，而非独立平铺 JobCard

### Requirement: Jobs 页面无标题
Jobs 页面 SHALL 不显示"Ingest Jobs"页面标题，直接展示筛选栏和任务列表。

#### Scenario: 页面布局
- **WHEN** 用户导航到 Jobs 页面
- **THEN** 页面顶部 SHALL 直接显示状态筛选 Tab，无页面级标题

## ADDED Requirements

### Requirement: Timeline 全局导航入口
系统 SHALL 在全局导航中新增 Timeline Tab，与现有的 Wiki、Ingest Hub、Jobs Tab 并列。

#### Scenario: Timeline Tab 展示
- **WHEN** 版本控制已启用
- **THEN** 全局导航 SHALL 显示 Timeline Tab

#### Scenario: 版本控制未启用时隐藏
- **WHEN** 版本控制未启用
- **THEN** Timeline Tab SHALL 显示为灰色或隐藏

### Requirement: Job execution log modal
Jobs 页面 SHALL 为每个摄入任务提供执行日志查看能力。

#### Scenario: Log button on job card
- **WHEN** 任务状态为 running、succeeded、failed 或 cancelled
- **THEN** 任务卡片 SHALL 显示「日志」按钮
- **WHEN** 任务状态为 queued
- **THEN** 卡片 MAY 不显示日志按钮（尚无执行记录）

#### Scenario: Open log modal
- **WHEN** 用户点击「日志」
- **THEN** 系统 SHALL 打开模态框，展示该 job 的执行事件时间线
- **AND** 每条事件 SHALL 可查看 step、phase、时间与 payload 详情

#### Scenario: LLM request and response display
- **WHEN** 事件 phase 为 request 或 response
- **THEN** 模态框 SHALL 以可读格式展示模型名、消息内容与响应预览（支持折叠/滚动）

#### Scenario: Poll while running
- **WHEN** 模态框打开且任务状态为 running
- **THEN** 系统 SHALL 每 2 秒刷新事件列表直至关闭模态框或任务结束

#### Scenario: Stale recovered hint
- **WHEN** 事件列表包含 `phase=stale_recovered`
- **THEN** 模态框 SHALL 显示说明：任务因心跳超时已重新入队，错误字段已清空

#### Scenario: Load failure
- **WHEN** events API 返回错误
- **THEN** 模态框 SHALL 显示错误提示，不静默失败
