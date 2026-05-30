## MODIFIED Requirements

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
