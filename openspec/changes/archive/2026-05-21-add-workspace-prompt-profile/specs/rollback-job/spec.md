## MODIFIED Requirements

### Requirement: Rollback job 执行流程
Rollback job 执行时 SHALL 从 git 获取 diff 和 source content，交由 LLM 生成回滚内容。回滚 LLM 的 system prompt SHALL 通过 `ComposeSystemPrompt(rollback, ctx)` 构建，包含工作区规则与忠实性约束。

#### Scenario: 获取回滚上下文
- **WHEN** rollback job 开始执行
- **THEN** 系统 SHALL 从 git 获取目标 commit 的 diff 和 commit message（包含 normalized source content）

#### Scenario: LLM 智能回滚
- **WHEN** 回滚上下文获取成功
- **THEN** 系统 SHALL 构造 LLM prompt，包含：
  - 目标 commit 的 diff（该次 ingest 改了什么）
  - Normalized source content（该次 ingest 的原始输入）
  - 当前 wiki 受影响文件的当前内容
- **AND** LLM system message SHALL 使用组合后的中文模板（`doc_language=zh` 时）并说明 FILE/DELETE 块格式
- **AND** LLM SHALL 输出回滚后的 wiki 文件内容

#### Scenario: 回滚结果写入
- **WHEN** LLM 成功生成回滚内容
- **THEN** 系统 SHALL 直接将回滚内容写入 wiki/ 目录（覆盖或删除对应文件）
- **AND** 执行 git add + commit，commit message 标记 `rollback: {original_source_filename}`
- **AND** 标记 rollback job 为 succeeded

#### Scenario: 回滚上下文缺失
- **WHEN** 目标 commit 的 message 中不包含 normalized content（格式异常或非 ingest 产生的 commit）
- **THEN** 系统 SHALL 标记 rollback job 为 failed，error_code 为 `rollback_context_missing`
