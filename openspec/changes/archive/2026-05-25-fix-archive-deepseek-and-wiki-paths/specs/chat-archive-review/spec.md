## MODIFIED Requirements

### Requirement: 确认执行与进度感知
ArchiveReviewCard SHALL 提供确认计划操作，并在执行期间展示进度。

#### Scenario: 确认计划并执行
- **WHEN** review 状态为 `ready_for_review`
- **AND** 用户点击「确认计划并执行」
- **THEN** UI SHALL 调用 `POST /api/v1/ingest/reviews/{id}/approve`
- **AND** 卡片 SHALL 显示 `applying` 进度态

#### Scenario: 执行成功
- **WHEN** review 状态变为 `succeeded`
- **AND** apply 实际写入了至少一个 wiki 页面
- **THEN** 卡片 SHALL 显示成功摘要（写入页面数大于 0）
- **AND** 若 `merge_commit_sha` 存在 SHALL 显示「查看变更 diff」入口

#### Scenario: 执行成功但零页面写入
- **WHEN** review 状态为 `failed` 且错误为无 wiki 文件写入
- **OR** apply job 的 result_summary 表明写入了 0 个页面
- **THEN** 卡片 SHALL 显示失败态与可操作的 remediation（重新规划或查看 job 日志）
- **AND** SHALL NOT 显示「归档成功」或「已写入 wiki」类误导文案

#### Scenario: 执行失败
- **WHEN** review 状态变为 `failed`
- **THEN** 卡片 SHALL 显示失败信息
- **AND** SHALL 提供「重新规划」操作
