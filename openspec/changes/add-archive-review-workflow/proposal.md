## Why

当前 OpenSpec 归档流程 (`openspec-archive-change`) 在检查 artifacts、sync specs、mv 到 `archive/` 后立即结束。归档后的实现阶段由 `openspec-apply-change` 独立负责，但后者仅作用于活跃 change（`openspec/changes/` 下），导致两条路径割裂。

实际使用中存在以下痛点：

1. **归档后缺乏结构化过渡**：change 归档后，实现完全依赖人工触发且无上下文衔接，LLM 从零理解要做什么
2. **缺少审核环节**：tasks.md 定义"做什么"，但"怎么做"从未被摊开讨论。LLM 直接修改文件，人类在改动前无决策窗口
3. **计划不可追溯**：LLM 的执行路径无法与原始设计对照，事后难以复盘
4. **一次生成无纠错**：tasks → 代码一步到位，中间没有质量检查或第二意见介入

本变更引入 **Plan-Review-Execute** 三段式归档后工作流，将"审核"作为一等环节嵌入流程，支持通过对话修改计划，并在确认后执行。

## What Changes

- **Phase 1: 归档（保持现有流程）**：检查 artifacts/tasks/specs，sync 后 mv 到 `archive/YYYY-MM-DD-name/`。不再终止——归档后自动进入下一阶段。
- **Phase 2: Plan 生成**：LLM 阅读 proposal + design + specs + 当前代码库状态，生成 `plan.md`——包含具体步骤（文件、操作、理由、风险、验证方式）的实现计划。同时初始化 `plan.log.md`（仅追加变更日志）。
- **Phase 3: 自动检查**：总是运行机械检查（lint）——文件引用存在性、步骤依赖无循环、必需字段齐全。可选启用双模型审核——独立 LLM 读取需求材料 + plan.md（但不读取对话历史），输出 `review_report.md` 做第二意见。设置中可开关、指定审核模型。
- **Phase 4: 人工审核（对话交互）**：人类同时看到 plan.md + lint_report.md + review_report.md（如启用）。可逐项审核或直接确认跳过。修改意见通过对话传达，LLM 更新 plan 并追加 plan.log.md。最终确认后进入执行。
- **Phase 5: 执行**：按 plan.md 逐步骤实现，每步完成后标记。中途问题可暂停并回退到 Phase 4 修订计划。
- **Phase 6: 关闭**：对照 plan 和 specs 做最终验收。全部文件（plan、lint、review、log）随 change 留在 archive/。

## Capabilities

### New Capabilities
- `archive-review-workflow`: Plan 生成、机械 lint、双模型审核调度、plan.log.md 仅追加日志、Phase 3-4-5-6 状态机编排

### Modified Capabilities
- `openspec-archive-change` (skill): 归档后不终止，触发 Plan 生成流程，新增 skip 快捷出口

## Impact

- **新增/修改 skill**: `.opencode/skills/openspec-archive-change/SKILL.md`——重写归档后阶段
- **新增脚本**: `scripts/review_plan.py`——双模型审核脚本（确定性 prompt 构建 + API 调用）
- **新增配置**: `openspec/config.yaml` 新增 `review` 段（`enabled`, `model`, `provider`, `api_base`）
- **新增输出文件**: `plan.md`, `plan.log.md`, `lint_report.md`, `review_report.md`（存于归档目录）
- **无运行时依赖**：所有逻辑在 OpenCode skill 层面和独立 Python 脚本中，不涉及 Go/React 代码变更
