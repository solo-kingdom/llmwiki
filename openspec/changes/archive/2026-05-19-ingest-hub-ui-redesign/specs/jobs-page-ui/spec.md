## ADDED Requirements

### Requirement: 独立 Jobs 全局页面
系统 SHALL 在全局导航中提供独立的 Jobs Tab，展示所有摄入任务列表，与 Ingest Hub 页面分离。

#### Scenario: 导航到 Jobs 页面
- **WHEN** 用户点击全局导航的 Jobs Tab
- **THEN** 系统 SHALL 展示独立的 Jobs 页面，包含状态筛选栏和任务列表

#### Scenario: 无任务空状态
- **WHEN** Jobs 页面打开且无任何摄入任务
- **THEN** 页面 SHALL 显示空状态提示"暂无摄入任务"

### Requirement: 状态筛选 Tab
Jobs 页面顶部 SHALL 提供状态筛选 Tab（All / Queued / Running / Succeeded / Failed），每个 Tab 显示对应任务数量 badge。

#### Scenario: 默认显示全部
- **WHEN** 用户进入 Jobs 页面
- **THEN** 默认选中"All" Tab，显示所有状态的任务列表

#### Scenario: 按状态筛选
- **WHEN** 用户点击某个状态 Tab（如"Failed"）
- **THEN** 任务列表 SHALL 仅显示该状态的任务

#### Scenario: 状态计数 badge
- **WHEN** Jobs 页面加载或刷新
- **THEN** 每个 Tab 旁边 SHALL 显示对应状态的任务数量（如"All 42"、"Failed 3"）

#### Scenario: 计数实时更新
- **WHEN** 后台轮询刷新 ingestJobs 数据
- **THEN** 状态 Tab 的计数 badge SHALL 自动更新

### Requirement: Job 卡片列表
每个摄入任务 SHALL 以卡片形式展示，包含来源路径、输入类型、创建时间、状态标签和操作按钮。

#### Scenario: 任务卡片基本展示
- **WHEN** 一个任务显示在列表中
- **THEN** 卡片 SHALL 展示来源路径（`source_path`）、输入类型（`input_type`）、创建时间（`created_at`）和状态标签

#### Scenario: 失败任务显示错误信息
- **WHEN** 任务状态为 failed 且有 `error_message` 或 `remediation`
- **THEN** 卡片 SHALL inline 显示错误信息和修复建议

#### Scenario: 失败任务显示重试按钮
- **WHEN** 任务状态为 failed
- **THEN** 卡片右侧 SHALL 显示"Retry"操作按钮

#### Scenario: 进行中任务显示取消按钮
- **WHEN** 任务状态为 queued 或 running
- **THEN** 卡片右侧 SHALL 显示"Cancel"操作按钮

#### Scenario: 状态标签样式
- **WHEN** 任务状态为 succeeded / failed / running / queued / cancelled
- **THEN** 状态标签 SHALL 使用对应语义颜色（succeeded=绿、failed=红、running=蓝、queued/cancelled=灰色）
