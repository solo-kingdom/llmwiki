## ADDED Requirements

### Requirement: 整理归档源文件自动清理
整理模式归档的 Plan→Apply 管线 SHALL 在应用计划后自动删除被 move/merge 替换的源文件。清理 SHALL 通过注入 `---DELETE---` blocks 到 `ApplyWikiBlocks()` 路径执行，确保路径验证和 worktree 兼容。

#### Scenario: move 动作删除源文件
- **WHEN** plan JSON 包含 `{"action":"move","from_path":"wiki/concepts/A_Player文化.md","to_path":"wiki/concepts/A Player文化.md","path":"wiki/concepts/A Player文化.md"}`
- **AND** Apply 阶段成功写入了 `wiki/concepts/A Player文化.md`
- **THEN** 系统 SHALL 删除 `wiki/concepts/A_Player文化.md`

#### Scenario: merge 动作删除源文件
- **WHEN** plan JSON 包含 `{"action":"merge","source_paths":["wiki/concepts/A_Player文化.md","wiki/concepts/A Player文化.md"],"to_path":"wiki/concepts/A Player文化.md","path":"wiki/concepts/A Player文化.md"}`
- **AND** Apply 阶段成功写入了 `wiki/concepts/A Player文化.md`
- **THEN** 系统 SHALL 删除 `source_paths` 中除 `to_path` 外的所有源文件

#### Scenario: update 动作不触发删除
- **WHEN** plan JSON 包含 `{"action":"update","path":"wiki/concepts/X.md"}`
- **THEN** 系统 SHALL NOT 删除任何文件

#### Scenario: 源路径与写入目标重合时跳过
- **WHEN** move 或 merge 的源路径与 LLM 生成的 FILE block 目标路径相同
- **THEN** 系统 SHALL 跳过该路径的 DELETE，避免删除刚写入的新文件

#### Scenario: 源路径必须通过路径验证
- **WHEN** plan JSON 中的 `from_path` 或 `source_paths` 无法通过 `NormalizeWikiFilePath` 验证
- **THEN** 系统 SHALL 跳过该路径的 DELETE 并记录 warning 日志

#### Scenario: 新字段缺失时无删除
- **WHEN** plan JSON 中 action 为 move 或 merge 但缺少 `from_path`/`source_paths` 字段
- **THEN** 系统 SHALL NOT 执行任何删除，行为与旧版本一致

#### Scenario: 删除操作记录到 job recorder
- **WHEN** post-apply cleanup 删除了文件
- **THEN** 系统 SHALL 记录 `step=apply_files` 事件包含被删除的路径列表

### Requirement: 整理 Plan JSON schema 扩展
整理模式和 QA 模式的 Plan JSON schema SHALL 支持可选的 `from_path`、`to_path`、`source_paths` 字段，让 move/merge 动作能明确表达源文件与目标文件。

#### Scenario: move 动作使用 from_path 和 to_path
- **WHEN** LLM 生成的 plan 包含页面重命名或迁移
- **THEN** plan prompt SHALL 指示模型输出 `{"action":"move","from_path":"...","to_path":"...","path":"...","rationale":"..."}`

#### Scenario: merge 动作使用 source_paths 和 to_path
- **WHEN** LLM 生成的 plan 包含多个页面合并为一个
- **THEN** plan prompt SHALL 指示模型输出 `{"action":"merge","source_paths":["...","..."],"to_path":"...","path":"...","rationale":"..."}`

#### Scenario: update 动作保持现有格式
- **WHEN** LLM 生成的 plan 仅更新页面内容
- **THEN** plan JSON SHALL 使用现有格式 `{"action":"update","path":"...","rationale":"..."}`，无需新增字段

#### Scenario: 向后兼容旧 plan JSON
- **WHEN** plan JSON 不包含 `from_path`、`to_path`、`source_paths` 字段
- **THEN** 系统 SHALL 正常执行 apply，不执行任何删除操作

### Requirement: 深度整理内容相似度检测
当用户在归档时启用深度整理，Plan 阶段 SHALL 对 wiki 页面执行内容相似度扫描，将检测到的相似页面对注入 plan prompt，让 LLM 在计划中体现 merge 建议。

#### Scenario: 深度整理开关启用
- **WHEN** 用户在归档对话框中勾选「深度整理」
- **AND** 当前 session mode 为 `organize`
- **THEN** 系统 SHALL 在 review 记录中存储 `deep_organize=true`

#### Scenario: Plan 阶段执行内容相似度扫描
- **WHEN** plan job 执行且 review 的 `deep_organize` 为 true
- **THEN** 系统 SHALL 使用 FTS 搜索扫描 wiki 页面内容相似度
- **AND** SHALL 将相似页面对（score >= 0.3）注入 plan prompt 作为上下文

#### Scenario: LLM 生成包含 merge 动作的计划
- **WHEN** plan prompt 包含相似页面信息
- **THEN** LLM SHALL 在 plan JSON 中建议 merge 动作，包含 `source_paths` 和 `to_path`

#### Scenario: 深度整理仅影响 organize 模式
- **WHEN** session mode 为 `ingest` 或 `qa`
- **THEN** 归档对话框 SHALL NOT 显示深度整理开关
- **AND** 归档行为 SHALL 不变

#### Scenario: 深度整理默认关闭
- **WHEN** 用户未勾选深度整理
- **THEN** review 的 `deep_organize` SHALL 为 false
- **AND** plan 阶段 SHALL NOT 执行内容相似度扫描
