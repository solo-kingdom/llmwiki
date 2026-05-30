## ADDED Requirements

### Requirement: Ingest commit 后可选自动 push
当 `vc_auto_push` 为 true 且已配置 `origin` 时，系统 SHALL 在 ingest 轨道 A commit 成功后尝试 push。

#### Scenario: 自动 push 在 ingest 成功后
- **WHEN** ingest job git commit 成功且 `vc_auto_push` 为 true 且 `origin` 已配置
- **THEN** the system SHALL attempt `git push`
- **AND** push 失败 SHALL NOT 将 job 标记为 failed

#### Scenario: 自动 push 关闭时不 push
- **WHEN** `vc_auto_push` 为 false
- **THEN** the system SHALL NOT push after ingest commit
