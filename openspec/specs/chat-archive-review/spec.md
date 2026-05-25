# chat-archive-review Specification

## Purpose
Define the Chat-embedded archive review closed loop: plan display, feedback, replan, approve, and Timeline diff linkage.

## Requirements

### Requirement: Chat 内嵌归档审阅卡片
Ingest Chat SHALL 在 composer 上方展示 **ArchiveReviewCard**，当 active session 存在关联 ingest review 时渲染，支持完整的审阅闭环而无需离开 Chat 页面。

#### Scenario: 归档后展示审阅卡片
- **WHEN** 用户确认归档且 API 返回 `review_id`
- **THEN** Chat SHALL 在 composer 上方展示 ArchiveReviewCard
- **AND** SHALL NOT 引导用户跳转独立 Review 页面

#### Scenario: 刷新后恢复审阅卡片
- **WHEN** 用户刷新页面或重新打开已归档 session
- **AND** session 存在 active ingest review
- **THEN** Chat SHALL 从 session API 恢复并渲染 ArchiveReviewCard

#### Scenario: 计划生成中状态
- **WHEN** review 状态为 `planning` 或 `revising`
- **THEN** 卡片 SHALL 显示加载指示器并轮询 review 状态（间隔不超过 5 秒）

### Requirement: 计划版本浏览与反馈
ArchiveReviewCard SHALL 展示当前计划版本的 markdown 内容，并支持自然语言反馈与重新规划。

#### Scenario: 展示计划 markdown
- **WHEN** review 状态为 `ready_for_review` 且计划版本可用
- **THEN** 卡片 SHALL 渲染 `plan_markdown`（wiki-prose 样式）
- **AND** SHALL 提供计划版本切换（v1/v2/…）

#### Scenario: 提交自然语言反馈
- **WHEN** review 状态为 `ready_for_review` 或 `failed`
- **AND** 用户输入反馈并提交
- **THEN** UI SHALL 调用 `POST /api/v1/ingest/reviews/{id}/feedback`

#### Scenario: 重新规划
- **WHEN** 用户点击「重新规划」
- **THEN** UI SHALL 调用 `POST /api/v1/ingest/reviews/{id}/replan`
- **AND** 卡片 SHALL 进入 `revising` 加载态直至新计划就绪

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

### Requirement: Archived 会话下的交互约束
当 session 已归档时，Chat composer SHALL 禁用，但 ArchiveReviewCard 中的审阅操作 SHALL 保持可用直至 review 终态。

#### Scenario: Composer 禁用
- **WHEN** active session `status` 为 `archived`
- **THEN** 消息输入与发送 SHALL 禁用

#### Scenario: 审阅操作仍可用
- **WHEN** session 已归档且 review 处于 `ready_for_review` 或 `failed`
- **THEN** ArchiveReviewCard 中的反馈、重新规划、确认执行 SHALL 仍可用
