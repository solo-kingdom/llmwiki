## Context

当前 `openspec-archive-change` skill 在完成 artifacts/tasks 检查、specs sync、mv 到 `archive/` 后直接结束。归档即终点。此后的实现由 `openspec-apply-change` 独立处理，但两者缺乏衔接——apply-change 仅作用于活跃 change，归档后的实现缺少结构化过渡和审核窗口。

本设计引入 **Plan-Review-Execute** 五阶段流水线（Phase 1-5），将归档从"终点"变为"实现阶段的起点"，并在"改代码"之前插入"审核计划"的决策层。

参考灵感来源：
- **LLM-Wiki-Skilled** 的"讨论后行动"模式——LLM 先摊开理解，人类对齐后再操作
- **OmegaWiki** 的双模型审核——独立 LLM 审核产出，保持评估独立性
- **Append-Only Log**——plan 演化的完全可追溯性

## Goals / Non-Goals

**Goals:**
- 归档后自动生成可审核的 `plan.md`（具体到文件、操作、理由、风险、验证方式）
- 提供机械检查（`lint_report.md`）验证 plan 的结构质量
- 支持可配置的双模型审核（`review_report.md`）：独立 LLM 审查 plan
- 通过对话方式修改 plan，所有变更记录在 `plan.log.md`（仅追加）
- 审核可跳过：人类确认即可进入执行，无需逐项审
- 执行按 plan 步骤推进，中断可回退修改 plan
- 所有产物（plan、lint、review、log）随 change 留在 archive 中

**Non-Goals:**
- 不替代 `openspec-apply-change`（后者仍用于活跃 change 的直接实现）
- 不修改 Go/React 代码——纯 OpenCode skill + Python 脚本变更
- 不引入数据库或持久化服务——所有状态存于 Markdown 文件
- 不做多阶段审批流（如多人 sign-off）
- 不在执行阶段引入自动化 CI/CD

## Architecture

### 五阶段流水线

```
┌─────────────────────────────────────────────────────────────────┐
│              ARCHIVE + PLAN + REVIEW + EXECUTE                   │
│                                                                  │
│  ┌─────────┐                                                     │
│  │ change  │  proposal ✓  design ✓  specs ✓  tasks ✓             │
│  │ active  │                                                     │
│  └────┬────┘                                                     │
│       │                                                          │
│       ▼                                                          │
│  ╔════════════════════════════════════════╗                       │
│  ║ PHASE 1: ARCHIVE (保持现有逻辑)         ║                      │
│  ║  · 检查 artifacts / tasks              ║                      │
│  ║  · sync specs                          ║                      │
│  ║  · mv → archive/YYYY-MM-DD-name/       ║                      │
│  ╚════════════════════════════════════════╝                       │
│       │                                                          │
│       ▼                                                          │
│  ╔════════════════════════════════════════╗                       │
│  ║ PHASE 2: PLAN GENERATION               ║                      │
│  ║                                        ║                      │
│  ║  读取: proposal + design + specs        ║                      │
│  ║       + 当前代码库状态                    ║                      │
│  ║                                        ║                      │
│  ║  输出:                                  ║                      │
│  ║   ├── plan.md      (实现计划)           ║                      │
│  ║   └── plan.log.md  (仅追加变更日志)      ║                      │
│  ╚════════════════════════════════════════╝                       │
│       │                                                          │
│       ▼                                                          │
│  ╔════════════════════════════════════════╗                       │
│  ║ 自动检查 (Phase 2 结束后自动运行)        ║                      │
│  ║                                        ║                      │
│  ║  lint (总是运行):                       ║                      │
│  ║    └── lint_report.md                  ║                      │
│  ║                                        ║                      │
│  ║  review (配置开关):                      ║                      │
│  ║    └── review_report.md                ║                      │
│  ╚════════════════════════════════════════╝                       │
│       │                                                          │
│       ▼                                                          │
│  ╔════════════════════════════════════════╗                       │
│  ║ PHASE 3: HUMAN REVIEW (对话审核)       ║                       │
│  ║                                        ║                      │
│  ║  人类看到三份文件:                       ║                      │
│  ║   · plan.md                            ║                      │
│  ║   · lint_report.md                     ║                      │
│  ║   · review_report.md (如启用)           ║                      │
│  ║                                        ║                      │
│  ║   "确认执行" ────────▶ Phase 4          ║                      │
│  ║   "第3步有问题..." ──▶ 对话循环 ──┐      ║                      │
│  ║                                │      ║                      │
│  ║          ◄── 更新 plan.md ──────┘      ║                      │
│  ║          ◄── 追加 plan.log.md          ║                      │
│  ║          ◄── 可选: 重新运行 lint/review  ║                      │
│  ╚════════════════════════════════════════╝                       │
│       │                                                          │
│       ▼                                                          │
│  ╔════════════════════════════════════════╗                       │
│  ║ PHASE 4: EXECUTION                     ║                      │
│  ║  · 按 plan.md 逐步骤执行                 ║                      │
│  ║  · 每步完成后标记 [x]                    ║                      │
│  ║  · 遇到问题 → 暂停 → 更新 plan → 继续    ║                      │
│  ║                                        ║                      │
│  ║  重大变更 (新增/删除步骤)                ║                      │
│  ║    → 回退到 Phase 3 重新人工确认         ║                      │
│  ║                                         ║                     │
│  ║  轻量变更 (实现方式微调)                  ║                      │
│  ║    → 原地修正 plan，备注原因即可           ║                      │
│  ╚════════════════════════════════════════╝                       │
│       │                                                          │
│       ▼                                                          │
│  ╔════════════════════════════════════════╗                       │
│  ║ PHASE 5: VERIFICATION & CLOSE          ║                       │
│  ║  · 对照 plan 确认全步骤完成              ║                       │
│  ║  · 对照 specs 做最终验收                 ║                       │
│  ║  · plan.md 追加 "## Execution Summary"  ║                      │
│  ║  · 所有文件留在 archive/ 中              ║                       │
│  ╚════════════════════════════════════════╝                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Key Decisions

### Decision 1: plan.md 格式

**选择**: 每个步骤包含 6 个必需字段，与 tasks.md 形成粒度差异。

tasks.md 定义"做什么"（what），plan.md 定义"怎么做"（how + where + why）。

```markdown
# Implementation Plan: <change-name>

## Overview
- **Total steps**: N
- **Files affected**: M
- **Risk level**: Low | Medium | High
- **Generated**: YYYY-MM-DD HH:MM

## Steps

### Step N: <标题>

- **File**: `<相对路径>:<行号或区域>`（必填）
- **Action**: ADD | MODIFY | DELETE | CREATE（必填）
- **Current state**: 当前代码/文件状态简述
- **Target state**: 修改后的期望状态
- **Rationale**: 为什么这样做
- **Risk**: None | Low | Medium | High，含缓解措施（非平凡步骤必填）
- **Verification**: 如何确认这一步成功完成
- **Dependencies**: 依赖的前置步骤编号（如无则填 None）

## Risk Assessment
| # | Risk | Severity | Step(s) | Mitigation |
|---|------|----------|---------|------------|
| 1 | ...  | Medium   | 4,5     | ...        |

## Coverage Matrix
| Spec Requirement | Covered By |
|------------------|------------|
| requirement-1    | Step 1, 3  |
```

**理由**: 足够具体让审核模型和人类都能量化评估，同时保持可读性。

### Decision 2: Skip 机制

**选择**: Skip 是对话的自然分支，不引入命令行 flag。

Phase 3 开始时 LLM 展示 plan 概览，并给出选项：

```
这是实现计划，共 15 步，涉及 8 文件。你想：
1. 逐项审核
2. 直接执行（跳过审核）
3. 先看某一步骤
```

人类选 2 即可跳过审核直接进入 Phase 4。选 1 进入对话审核循环。

**理由**: 不需要额外参数、不引入 CLI 复杂性。流程默认有审核但随时可跳过。

### Decision 3: Plan 质量自动检查 (Lint)

**选择**: 两层检查——机械检查（确定性脚本）+ 语义检查（LLM）。

**Layer 1 — 机械检查**（总是运行，由 Python 脚本执行）:

| 检查项 | 检查内容 | 失败级别 |
|--------|----------|----------|
| `check_file_refs` | 每个步骤是否引用至少一个文件路径 | ⚠️ warning |
| `check_file_exists` | 引用文件在代码库中是否真实存在 | ❌ error |
| `check_deps` | 步骤依赖无循环（DAG 拓扑排序验证） | ❌ error |
| `check_structure` | 必需字段齐全（File, Action, Rationale, Verification 等） | ❌ error |
| `check_no_duplicates` | 无两个步骤做同样的事情 | ⚠️ warning |
| `check_coverage` | 所有 spec requirements 至少被一个步骤覆盖 | ⚠️ warning |

**Layer 2 — 语义检查**（与双模型审核合并，避免重复 LLM 调用）：
- Scope creep: plan 是否超出了 proposal 声明的范围
- Consistency: 步骤间是否有逻辑矛盾
- Risk adequacy: 非平凡步骤是否标注了风险和缓解措施

**输出**: `lint_report.md` 包含通过/失败统计和逐项详情。

**理由**: 机械检查零成本、零幻觉，应总是运行。语义检查复用双模型审核能力。

### Decision 4: 双模型审核

**选择**: 配置驱动 + 独立 LLM 调用 + 不读取对话历史。

**审核模型输入**（保持独立性）:
- ✅ `proposal.md` + `design.md` + specs（需求材料）
- ✅ 代码库结构摘要（当前状态）
- ✅ `plan.md`（待审核产出）
- ❌ 对话历史（避免被生成模型的推理带偏）
- ❌ `plan.log.md`（审核应基于最终 plan，而非演变过程）

**审核模型输出**: `review_report.md`

```markdown
# Review Report: <change-name>
**Review Model**: claude-sonnet-4-20250514
**Timestamp**: 2026-05-21 14:30

## Overall Assessment: APPROVED | APPROVED WITH SUGGESTIONS | NEEDS REVISION

### Issues Found
| Step | Issue | Severity | Suggestion |
|------|-------|----------|------------|
| 3    | 缺少空值边界处理  | MEDIUM | 增加 fallback 步骤 |
| 7    | 范围过大，超出 spec | LOW    | 缩限到核心页面 |

### Coverage Analysis
| Spec Requirement | Covered? |
|------------------|----------|
| req-1            | ✅ Step 1-2 |
| req-2            | ⚠️ Partial (Step 5) |
| req-3            | ❌ Not covered |

### Risk Assessment
- ⚠️ Step 4→5 依赖链：Step 4 失败会阻断 Step 5
- ✅ 总体计划可行，范围合理
```

**调用机制**:

```python
# scripts/review_plan.py
# 确定性脚本——不做 LLM 推理，只构建 prompt + 调用 API
def review_plan(plan_path, context_dir, config):
    # 1. 读取上下文（不含对话历史）
    # 2. 构建审核 prompt
    # 3. 调用 config.review.model 指定的 LLM API
    # 4. 写入 review_report.md
```

**理由**:
- 脚本与 LLM 分离，符合 OmegaWiki 的 Skill/Tool 分离原则
- 审核模型通过配置指定，完全解耦
- API key 通过环境变量 `OPENSPEC_REVIEW_API_KEY` 传入，不入仓库

### Decision 5: 审核配置

**选择**: 在 `openspec/config.yaml` 中新增 `review` 段。

```yaml
# openspec/config.yaml
schema: spec-driven

review:
  enabled: true              # true | false | "ask"
  model: "claude-sonnet-4-20250514"
  provider: "anthropic"      # anthropic | openai | deepseek | custom
  api_base: ""               # 可选，自定义 endpoint
  # api_key 从环境变量 OPENSPEC_REVIEW_API_KEY 读取

context: |
  ...
```

**`enabled` 三种模式**:
- `true`: 每次 Phase 2 后自动运行审核
- `false`: 跳过双模型审核（但 lint 仍运行，Phase 3 人工审核仍在）
- `"ask"`: 每次 Phase 2 后询问是否运行审核

**理由**: 不同场景有不同需求。快速修复 false，复杂重构 true，不确定时 ask。

### Decision 6: plan.log.md（仅追加日志）

**选择**: 仅追加，不可修改。记录 plan 的每一次变化。

```markdown
# Plan Change Log: <change-name>

## [2026-05-21 14:30] Plan Created
- **Action**: Initial plan generated from proposal, design, specs, and codebase analysis
- **Steps**: 15
- **Risk**: Low

## [2026-05-21 14:35] Human Review - Round 1
- **Action**: Human requested modifications
- **Removed**: Step 8 (redundant with Step 6)
- **Modified**: Step 12 — changed approach from direct mutation to helper function
- **Added**: Step 15.5 — edge case handling for empty language values
- **Steps**: 15 (1 removed, 1 added)

## [2026-05-21 14:40] Plan Confirmed
- **Action**: Human confirmed plan, proceeding to execution
- **Final steps**: 15

## [2026-05-21 15:20] Execution - Plan Amended
- **Action**: Step 9 encountered unexpected type mismatch during execution
- **Modified**: Step 9 — updated approach based on actual code state
```

**理由**: 
- 完全可追溯——每一步修改都有记录
- 可解析——格式统一，未来可做统计分析
- 与 LLM-Wiki-Skilled 的 `wiki/log.md` 设计理念一致

### Decision 7: 与现有 openspec-archive-change 的集成方式

**选择**: 重写 `openspec-archive-change` skill，将 Phase 1 后不终止，继续 Phase 2-5。

原 skill 的第 5 步（"Perform the archive"）之后不再是"Display summary"终止，而是：

```
5. Perform the archive (mv → archive/)
6. [NEW] Generate plan (Phase 2)
7. [NEW] Run automated checks (lint + optional review)
8. [NEW] Enter human review dialog (Phase 3) — with skip option
9. [NEW] Execute plan (Phase 4)
10. [NEW] Verify and close (Phase 5)
```

**理由**: 流程一体化，减少技能碎片。用户在 `/opsx-archive` 后就进入完整流水线。

## Risks / Trade-offs

| Risk | Severity | Mitigation |
|------|----------|------------|
| 审核模型 API 不可用 | Medium | 如果审核调用失败，降级为仅 lint + 人工审核，继续 Phase 3 |
| Plan 粒度不当（太细或太粗） | Low | 通过对话审核调整，plan.log.md 记录迭代 |
| 执行中频繁回退打断流程 | Low | 仅重大变更回退 Phase 3，轻量变更原地修正 |
| 双模型审核增加时间和成本 | Low | 可关闭（`enabled: false`），且仅复杂 change 需要 |
| plan.md 与 tasks.md 信息重叠 | Low | plan.md 是"如何实现"层，tasks.md 是"做什么"层，互补不冲突 |
