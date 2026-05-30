## MODIFIED Requirements

### Requirement: Timeline 全局页面
系统 SHALL 在全局导航中提供 Timeline Tab，展示 wiki 版本历史（轨道 A commit only）。

#### Scenario: 导航到 Timeline
- **WHEN** 用户点击全局导航的 Timeline Tab
- **THEN** 系统 SHALL 展示 Timeline 页面，按时间倒序显示 ingest/rollback commit 列表
- **AND** SHALL NOT 显示 `backup:` 前缀的备份快照 commit

#### Scenario: Legacy workspace 缺少 git
- **WHEN** workspace 无 `.git` 目录
- **THEN** Timeline 页面 SHALL 显示空状态，提示用户运行 `llmwiki init <dir>` 补全版本控制

#### Scenario: 无 commit 历史
- **WHEN** git 已初始化但无 ingest commit（仅有 initial commit 或无 commit）
- **THEN** Timeline 页面 SHALL 显示 "No history yet"

## MODIFIED Requirements

### Requirement: Commit 列表展示
Timeline 页面 SHALL 以条目形式展示每个 ingest/rollback commit。

#### Scenario: Commit 条目内容
- **WHEN** 一个 ingest 或 rollback commit 显示在列表中
- **THEN** 每个 commit 条目 SHALL 展示：
  - Commit subject line（如 "ingest: paper.pdf" 或 "rollback: paper.pdf"）
  - 提交时间（相对时间，如 "2 hours ago"）
  - 变更文件数量
  - [View Diff] 按钮
  - [Rollback] 按钮（仅 ingest commit 显示，rollback commit 不显示）

#### Scenario: Commit 列表分页
- **WHEN** commit 数量超过 50 条
- **THEN** 系统 SHALL 支持加载更多（lazy loading 或分页）

## MODIFIED Requirements

### Requirement: Diff 查看模态框
用户点击 [View Diff] 时 SHALL 在模态框中展示 commit 的 wiki 相关文件变更差异。

#### Scenario: 打开 diff 查看器
- **WHEN** 用户点击某个 ingest/rollback commit 的 [View Diff] 按钮
- **THEN** 系统 SHALL 打开模态框，展示该 commit 的 unified diff 内容
- **AND** diff 内容 SHALL 支持语法高亮（markdown）
- **AND** diff SHALL 仅针对该 commit 的变更（对 ingest commit 仍为 wiki 变更语义）
