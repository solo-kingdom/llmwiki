## ADDED Requirements

### Requirement: Ingest job 自动 git commit
系统 SHALL 在 ingest job pipeline 成功后、标记 job succeeded 之前，自动执行 git commit。

#### Scenario: Pipeline 成功后自动提交
- **WHEN** ingest job 的 LLM pipeline 成功执行并写入 wiki 文件
- **THEN** 系统 SHALL 调用 git commit 提交 wiki/ 变更，commit message 包含该 job 的 normalized source content
- **AND** git commit 成功后标记 job 为 succeeded

#### Scenario: Pipeline 失败不触发提交
- **WHEN** ingest job 的 LLM pipeline 执行失败
- **THEN** 系统 SHALL NOT 执行 git commit，标记 job 为 failed 并记录错误信息

### Requirement: Pipeline 失败与 commit 失败分离
系统 SHALL 在 job 处理流程中区分 pipeline 阶段和 commit 阶段的失败，支持独立重试。

#### Scenario: Pipeline 失败重试
- **WHEN** job 因 pipeline 阶段失败（LLM 调用错误、normalize 错误等）
- **THEN** 系统 SHALL 在 error_code 中标记 `pipeline_failed`
- **AND** retry 时重新执行完整 pipeline（normalize → analyze → generate → write）

#### Scenario: Commit 失败重试
- **WHEN** job pipeline 成功但 git commit 失败
- **THEN** 系统 SHALL 在 error_code 中标记 `commit_failed`
- **AND** retry 时仅重新执行 git add + commit，不重跑 LLM pipeline

#### Scenario: 版本控制未启用时跳过 commit
- **WHEN** workspace 未启用版本控制
- **THEN** 系统 SHALL 跳过 git commit 阶段，pipeline 成功后直接标记 job succeeded

### Requirement: Commit message 包含 normalized source content
系统 SHALL 将 job 的 normalized source content 嵌入 git commit message，供回滚时 LLM 参考。

#### Scenario: 文本内容嵌入
- **WHEN** ingest job 成功并执行 git commit
- **THEN** commit message body 中 SHALL 包含完整的 normalized source content，包裹在 `---NORMALIZED-START---` 和 `---NORMALIZED-END---` 分隔符之间

#### Scenario: 元数据嵌入
- **WHEN** ingest job 成功并执行 git commit
- **THEN** commit message body 中 SHALL 包含 job_id、source filename、input_type 元数据
