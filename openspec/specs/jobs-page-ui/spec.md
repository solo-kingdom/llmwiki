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
每个摄入任务 SHALL 以卡片形式展示，包含来源路径、输入类型、创建时间、状态标签和操作按钮。来源路径对支持预览的文件格式可点击。cancelled 状态增加 Restart 操作按钮。

#### Scenario: 任务卡片基本展示
- **WHEN** 一个任务显示在列表中
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
