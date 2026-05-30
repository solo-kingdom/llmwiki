## Why

当前摄入结果会把具体实体与抽象概念绑定成单个概念页，例如 `AppLovin组织裁剪方法论`。这会削弱概念的复用性，让知识图谱过度依赖单个案例，并让后续整理、对比和跨实体链接变困难。

现在需要把“实体、概念、关系”作为独立抽取对象来约束提示词与整理检查：实体页承载具体对象事实，概念页承载可复用抽象，二者通过 wikilink 建立关系，而不是混合在标题和路径里。

## What Changes

- 强化摄入分析提示词：要求先识别实体、概念、论点与关系，并显式检查“实体名 + 抽象概念”的混绑候选。
- 强化生成提示词：概念页标题默认保持中性，不应包含具体公司、人物或产品名；案例上下文应写入正文并链接实体页。
- 同步更新 `skills/llmwiki-ingest` 的中英文蓝本，沉淀实体/概念判定规则、反例和命名策略。
- 扩展整理/诊断能力：在 organize/lint 场景中提示并报告疑似实体-概念混绑页面，给出拆分或重命名建议。
- 保持现有 typed wiki 目录规则：实体仍位于 `wiki/entities/`，概念仍位于 `wiki/concepts/`，本次变化聚焦语义分类和命名质量。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `ingest-pipeline`: 摄入分析与生成提示词必须区分实体、概念和关系，并避免创建实体绑定型概念页。
- `wiki-lint`: 健康检查应能报告疑似实体-概念混绑的概念页，并给出可操作的整理建议。
- `typed-wiki-organization`: typed wiki 组织规则应定义实体页与概念页的语义边界和命名约束。

## Impact

- `skills/llmwiki-ingest/SKILL.md` 与 `skills/llmwiki-ingest/SKILL.zh.md`：补充实体/概念判定、命名和反模式规则。
- `internal/ingest/prompts.go`：同步更新 `StepAnalysis`、`StepGeneration`，必要时更新 organize 相关提示词。
- `internal/engine/lint.go` 及相关测试：新增启发式 lint 检查，识别 `wiki/concepts/` 中标题疑似以已知实体名开头并拼接抽象术语的页面。
- `internal/mcp/diagnostic_tools.go` / lint 输出解释：让 organize 模式能把此类问题作为结构性建议呈现。
- OpenSpec specs 与测试：为提示词行为、语义组织约束和 lint 行为补充可验证场景。
