## ADDED Requirements

### Requirement: Rollback job 类型
系统 SHALL 支持新的 job 类型 `rollback`，用于智能回滚指定 commit 的 wiki 变更。

#### Scenario: 创建 rollback job
- **WHEN** 用户请求回滚指定 commit
- **THEN** 系统 SHALL 创建一条 `input_type = 'rollback'` 的 ingest job，`source_ref` 存储目标 commit SHA，状态为 `queued`

#### Scenario: Rollback job 入队串行执行
- **WHEN** rollback job 创建后
- **THEN** 系统 SHALL 将其加入与 ingest job 共享的串行队列，等待 worker 逐个处理

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

### Requirement: 回滚源文件归档
回滚时系统 SHALL 将 raw/sources/ 中对应的原始文件移动到 revert/ 目录。

#### Scenario: 源文件存在时移动
- **WHEN** 回滚目标 commit 引用的源文件在 `raw/sources/` 中存在
- **THEN** 系统 SHALL 将该文件移动到 `revert/{commit-sha-short}-{filename}` 路径
- **AND** revert/ 目录 SHALL 持久保存，不自动清理

#### Scenario: 源文件不存在时跳过
- **WHEN** 回滚目标 commit 引用的源文件在 `raw/sources/` 中不存在
- **THEN** 系统 SHALL 跳过文件移动步骤，继续执行 LLM 回滚

### Requirement: Rollback job 与 ingest job 互斥
系统 SHALL 保证 rollback job 和 ingest job 不会并发执行。

#### Scenario: 串行处理
- **WHEN** 队列中同时存在 ingest job 和 rollback job
- **THEN** 系统 SHALL 由同一个 worker 逐个处理，不并发执行
