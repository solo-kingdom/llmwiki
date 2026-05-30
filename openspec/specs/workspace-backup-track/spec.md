## ADDED Requirements

### Requirement: 备份轨道 commit
系统 SHALL 支持独立于 ingest 的备份快照 commit（轨道 B），commit subject 以 `backup:` 前缀标识，且不修改轨道 A 的 `AddCommit` 行为。

#### Scenario: 有变更时创建备份 commit
- **WHEN** 系统执行备份且备份路径集合中存在未提交变更
- **THEN** SHALL 对备份路径执行 `git add` 并 `git commit -m "backup: snapshot"`
- **AND** SHALL 返回 commit SHA

#### Scenario: 无变更跳过备份 commit
- **WHEN** 备份路径集合无任何变更
- **THEN** SHALL 跳过 commit，不产生空 commit

### Requirement: 备份路径集合
系统 SHALL 按配置将以下路径纳入轨道 B 备份范围：

- **固定路径**: `purpose.md`, `rules.md`, `.llmwiki/prompts.yaml`（若存在）, `.llmwiki/workspace-settings.json`（若存在）, `.gitignore`
- **条件路径**: `raw/` 当且仅当 `backup_include_raw` 为 true（默认 true）

#### Scenario: 默认包含 raw
- **WHEN** `backup_include_raw` 未配置或为空
- **THEN** SHALL 视同为 true，`raw/` 纳入备份 add 范围

#### Scenario: 关闭 raw 备份
- **WHEN** `backup_include_raw` 为 false
- **THEN** SHALL NOT 将 `raw/` 加入备份 add
- **AND** SHALL 确保 workspace `.gitignore` 包含 `raw/` 条目

### Requirement: 备份触发
系统 SHALL 在以下时机尝试执行备份（导出 settings 文件后执行 `BackupCommit`）：

#### Scenario: Settings 保存后备份
- **WHEN** 客户端 `PUT /settings` 成功持久化
- **THEN** SHALL 导出 workspace settings 文件并执行备份 commit

#### Scenario: 手动备份
- **WHEN** 客户端调用 `POST /api/v1/vcs/backup`
- **THEN** SHALL 导出 workspace settings 文件（若可导出）并执行备份 commit

#### Scenario: ingest 不自动备份
- **WHEN** ingest job 成功完成轨道 A commit
- **THEN** SHALL NOT 自动执行轨道 B 备份 commit

### Requirement: 备份与 wiki 轨道隔离
系统 SHALL NOT 在轨道 B 的 backup commit 中包含 `wiki/` 路径的 add；`wiki/` 变更仅由轨道 A 提交。

#### Scenario: 仅 wiki 变更时备份
- **WHEN** 仅 `wiki/` 有变更且无备份路径变更
- **THEN** 备份 commit SHALL 被跳过
