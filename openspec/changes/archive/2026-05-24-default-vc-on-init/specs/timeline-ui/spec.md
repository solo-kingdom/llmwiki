## MODIFIED Requirements

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
