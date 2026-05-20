## ADDED Requirements

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
