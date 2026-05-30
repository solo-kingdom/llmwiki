## ADDED Requirements

### Requirement: Review Job 分组展示
系统 SHALL 对 `source_ref` 以 `review:` 开头的 ingest job 按 `source_ref` 值进行分组，每个分组作为一个聚合卡片展示。

#### Scenario: 同一 review 下多个 job 聚合为一个分组卡片
- **WHEN** 任务列表中存在多条 job 的 `source_ref` 相同且以 `review:` 开头
- **THEN** 系统 SHALL 将这些 job 聚合为一个分组卡片
- **AND** 分组卡片内按 `created_at` 降序排列

#### Scenario: 分组卡片展示最新活跃 job
- **WHEN** 一个分组内有 N 条 job
- **THEN** 分组卡片 SHALL 直接展示最新一条（`created_at` 最大）的完整信息，包括来源路径、输入类型、状态标签、操作按钮
- **AND** 操作按钮（Retry/Cancel/Restart）与现有 JobCard 行为一致

#### Scenario: 分组卡片折叠历史记录
- **WHEN** 一个分组内有超过 1 条 job
- **THEN** 分组卡片 SHALL 显示「历史记录 (N-1)」折叠区域
- **AND** 默认收起，点击后展开显示旧 job 的摘要信息（input_type、status、created_at）
- **AND** 历史 job 不提供操作按钮

#### Scenario: 单条 review job 也使用分组卡片
- **WHEN** 一个 review 分组内仅有 1 条 job
- **THEN** 系统 SHALL 仍以分组卡片形式展示
- **AND** 不显示「历史记录」折叠区域

### Requirement: 非 Review Job 保持平铺
系统 SHALL 对 `source_ref` 不以 `review:` 开头的 job（如普通 file/text ingest、rollback）保持原有平铺展示，不进行分组。

#### Scenario: 普通 file ingest job 单独展示
- **WHEN** 任务的 `source_ref` 为空或不以 `review:` 开头
- **THEN** 系统 SHALL 以现有 JobCard 形式单独平铺展示

### Requirement: 分组卡片状态筛选联动
系统 SHALL 在状态筛选 Tab 选中时，按分组维度过滤展示。

#### Scenario: 分组内有 job 匹配筛选状态则整体显示
- **WHEN** 用户选中 "Failed" 筛选
- **AND** 某分组内有至少一条 job 状态为 failed
- **THEN** 系统 SHALL 显示该分组卡片
- **AND** 分组内所有 job（活跃 + 历史）均可见

#### Scenario: 分组内无 job 匹配则隐藏
- **WHEN** 用户选中 "Failed" 筛选
- **AND** 某分组内没有任何 job 状态为 failed
- **THEN** 系统 SHALL 隐藏该分组卡片

### Requirement: 分组与平铺混合时间排序
系统 SHALL 将分组卡片与平铺 JobCard 统一按最新 job 的 `created_at` 降序排列。

#### Scenario: 分组卡片与平铺 JobCard 混合排序
- **WHEN** 任务列表同时包含分组卡片和平铺 JobCard
- **THEN** 系统 SHALL 按每个卡片最新 job 的 `created_at` 降序统一排列
