## Context

现有 `session_archive` 流程在 `ArchiveIngestSession` 里写入归档源文件后，立即创建 `queued` ingest job，后台处理器会直接进入两阶段流水线并落盘 wiki 文件。系统目前缺失“计划可审阅”和“人类批准”这两个阶段。

用户已明确以下产品约束：

- 归档后默认停留在 Chat，仅提示去审核
- 审核阶段仅接受自然语言反馈，不提供计划结构化手工编辑
- 审核通过后必须基于最终计划重新生成 FILE blocks 再执行
- 失败恢复入口在 Review 页面，直接“重新规划”
- 回滚粒度为 job 级，针对本次归档最终执行产物
- 审核界面为独立页面

## Goals / Non-Goals

**Goals**

- 将 session archive 改为“计划先行、审核后执行”的双阶段闭环
- 让用户可通过自然语言反馈多轮修正计划
- 将执行行为严格限制在“审核通过后”
- 提供可追踪的计划版本与执行关联
- 在 Review 页面形成失败恢复主路径（重新规划）

**Non-Goals**

- 不引入“直接编辑 plan JSON/Markdown”能力
- 不在本变更中引入跨模型二次评审
- 不改变现有 job 级回滚机制的基本语义
- 不重构整个 Jobs 页为审阅中心

## End-to-End Flow

```text
Chat Session
  └─ Archive
      ├─ 冻结 archive source (session transcript)
      ├─ 创建 review (status=planning)
      └─ 触发 plan generation -> plan v1 (status=ready_for_review)

Review Page
  ├─ 查看 plan vN
  ├─ 输入自然语言反馈
  ├─ 点击“重新规划” -> plan vN+1
  └─ 点击“审核通过” -> review status=approved

Apply Execution
  ├─ 以已批准的计划为约束重新生成 FILE blocks
  ├─ 执行 apply files / index / optional git commit
  └─ review status=succeeded | failed

Failure Recovery
  └─ 在 Review 页面点击“重新规划”，返回 revising -> ready_for_review
```

## Decisions

### D1: 引入 Review 实体，解耦“计划生成”和“文件执行”

**Decision**: 新增 review 领域对象，归档后先进入 review，而非直接执行 ingest job。

**Rationale**:
- 现有 ingest job 模型偏执行态，缺少审阅与多轮反馈语义
- Review 作为上层编排对象，可以承载计划版本和审核决策

### D2: 审核输入仅自然语言

**Decision**: Review 仅支持自然语言反馈消息，不支持直接编辑计划结构。

**Rationale**:
- 符合用户指定交互
- 降低前端复杂度与计划结构破坏风险

### D3: 审核通过后重生成 FILE blocks

**Decision**: 审核通过时不复用任何旧生成结果，必须基于最终计划版本重新生成并执行。

**Rationale**:
- 避免“计划版本”和“执行产物”漂移
- 保证批准内容与最终修改一致

### D4: Review 页面作为失败恢复主入口

**Decision**: 执行失败后，用户在 Review 页面直接触发“重新规划”，而不是跳转 Jobs 再重试。

**Rationale**:
- 失败语义通常与计划质量相关，应该在审阅语境下修复
- 降低多页面跳转带来的认知开销

### D5: 归档后停留 Chat，仅引导审核

**Decision**: 归档请求成功后，Chat 不自动跳转，展示“去审核”提示（可携带 review id 快捷入口）。

**Rationale**:
- 保持当前聊天上下文连续性
- 将“是否立即进入审核”交给用户

## Data Model (Proposed)

### `ingest_reviews`

- `id`
- `session_id`
- `archive_source_path`
- `status` (`planning`, `ready_for_review`, `revising`, `approved`, `applying`, `succeeded`, `failed`, `cancelled`)
- `current_plan_version`
- `approved_plan_version`
- `final_job_id`
- `created_at`, `updated_at`

### `ingest_review_messages`

- `id`
- `review_id`
- `role` (`user`, `assistant`, `system`)
- `message_type` (`feedback`, `plan_summary`, `status_note`)
- `content`
- `created_at`

### `ingest_review_plans`

- `id`
- `review_id`
- `version`
- `plan_markdown` (人类审阅)
- `plan_json` (系统执行约束)
- `created_at`

## API Surface (Proposed)

- `POST /api/v1/ingest/sessions/{id}/archive`
  - 行为改为：创建 review + 启动规划
  - 返回：`review_id`、`status`
- `GET /api/v1/ingest/reviews`
  - 列表查询
- `GET /api/v1/ingest/reviews/{id}`
  - 详情（含当前计划版本摘要）
- `GET /api/v1/ingest/reviews/{id}/plans`
  - 计划版本列表
- `POST /api/v1/ingest/reviews/{id}/feedback`
  - 添加自然语言反馈
- `POST /api/v1/ingest/reviews/{id}/replan`
  - 基于反馈生成下一版计划
- `POST /api/v1/ingest/reviews/{id}/approve`
  - 审核通过并触发 apply job（重生成 FILE blocks）

## UI Integration

- 新增 Workbench 视图 `review`，对应独立 Review 页面
- Chat 归档成功后弹出成功提示，附“去审核”入口
- Review 页面核心模块：
  - review 列表与筛选（待审/失败/已完成）
  - 计划版本浏览（v1/v2/v3）
  - 自然语言反馈输入框
  - 操作按钮：`重新规划`、`审核通过`
  - 执行态显示与失败后的“重新规划”按钮

## Execution Semantics

- **Planning Phase**:
  - 仅生成计划，不调用文件写入逻辑
  - 即使模型输出 FILE blocks，也只记录，不执行
- **Apply Phase**:
  - 读取 `approved_plan_version`
  - 重新调用生成阶段产出 FILE blocks
  - 执行 `ApplyWikiBlocks`、索引更新、可选 git commit
  - 失败时记录到 review 与 job，并可回到 replan 流程

## Risks / Trade-offs

- **状态机复杂度上升**：新增 review 状态需要严格转换校验，避免出现“approved 但无 plan”之类非法状态
- **计划与执行一致性约束成本**：重生成 FILE blocks 会增加一次 LLM 调用成本，但换来可审计一致性
- **双页面信息分流**：Jobs 与 Review 并存可能引导混淆，需要清晰分工（Review 管决策，Jobs 管执行日志）
- **失败重规划循环风险**：若没有反馈质量约束，可能陷入反复重规划；可后续加失败原因提示模板提升反馈质量
