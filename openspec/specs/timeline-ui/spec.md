# timeline-ui Specification

## Purpose
Define the Timeline page for viewing wiki git history, diffs, and rollback operations.
## Requirements
### Requirement: Timeline 全局页面
系统 SHALL 在全局导航中提供 Timeline Tab，展示 wiki 版本历史。

#### Scenario: 导航到 Timeline
- **WHEN** 用户点击全局导航的 Timeline Tab
- **THEN** 系统 SHALL 展示 Timeline 页面，按时间倒序显示 git commit 列表

#### Scenario: Legacy workspace 缺少 git
- **WHEN** workspace 无 `.git` 目录
- **THEN** Timeline 页面 SHALL 显示空状态，提示用户运行 `llmwiki init <dir>` 补全版本控制

#### Scenario: 无 commit 历史
- **WHEN** git 已初始化但无 ingest commit（仅有 initial commit 或无 commit）
- **THEN** Timeline 页面 SHALL 显示 "No history yet"

### Requirement: Commit 列表展示
Timeline 页面 SHALL 以条目形式展示每个 commit。

#### Scenario: Commit 条目内容
- **WHEN** 一个 commit 显示在列表中
- **THEN** 每个 commit 条目 SHALL 展示：
  - Commit subject line（如 "ingest: paper.pdf" 或 "rollback: paper.pdf"）
  - 提交时间（相对时间，如 "2 hours ago"）
  - 变更文件数量
  - [View Diff] 按钮
  - [Rollback] 按钮（仅 ingest commit 显示，rollback commit 不显示）

#### Scenario: Commit 列表分页
- **WHEN** commit 数量超过 50 条
- **THEN** 系统 SHALL 支持加载更多（lazy loading 或分页）

### Requirement: Diff 查看模态框
用户点击 [View Diff] 时 SHALL 在模态框中展示 commit 的文件变更差异。

#### Scenario: 打开 diff 查看器
- **WHEN** 用户点击某个 commit 的 [View Diff] 按钮
- **THEN** 系统 SHALL 打开模态框，展示该 commit 的 unified diff 内容
- **AND** diff 内容 SHALL 支持语法高亮（markdown）

#### Scenario: Diff 文件列表
- **WHEN** diff 涉及多个文件
- **THEN** 模态框 SHALL 展示变更文件列表，点击文件名跳转到对应 diff 部分

### Requirement: Rollback 操作确认
用户触发 rollback 时 SHALL 经过确认步骤。

#### Scenario: 点击 Rollback
- **WHEN** 用户点击某个 ingest commit 的 [Rollback] 按钮
- **THEN** 系统 SHALL 显示确认对话框，说明：
  - 将回滚该次 ingest 的 wiki 变更
  - 原始源文件将移动到 revert/ 目录（如仍存在）
  - 回滚操作不可撤销（但可通过 Timeline 查看历史）
- **AND** 提供 [Confirm Rollback] 和 [Cancel] 按钮

#### Scenario: 确认回滚
- **WHEN** 用户确认回滚
- **THEN** 系统 SHALL 创建 rollback job 并返回
- **AND** 该 commit 条目的 [Rollback] 按钮变为 loading 状态
- **AND** rollback job 完成后 Timeline 列表刷新，显示新的 rollback commit

### Requirement: Timeline API
系统 SHALL 提供 git 历史和 diff 查询的 HTTP API。

#### Scenario: 获取 commit 列表
- **WHEN** 客户端请求 commit 历史（带可选 limit 参数）
- **THEN** 系统 SHALL 返回 commit 列表，每条包含：SHA、subject、时间戳、变更文件数

#### Scenario: 获取 commit diff
- **WHEN** 客户端请求指定 commit 的 diff
- **THEN** 系统 SHALL 返回 unified diff 内容

#### Scenario: 触发 rollback
- **WHEN** 客户端发送 rollback 请求（包含 commit SHA）
- **THEN** 系统 SHALL 创建 rollback job 并返回 job 信息

### Requirement: Commit diff deep link from Chat
Timeline SHALL support opening a specific commit diff via URL query parameters so Chat archive review cards can link directly to diff view.

#### Scenario: Open diff via commit query
- **WHEN** user navigates to Timeline with `commit=<sha>` query parameter
- **AND** workspace has `.git` initialized
- **THEN** Timeline SHALL open CommitDiffDialog for the specified commit SHA

#### Scenario: Invalid commit SHA
- **WHEN** user navigates with an unknown or invalid commit SHA
- **THEN** Timeline SHALL show an error toast or inline message
- **AND** SHALL display the normal commit list

