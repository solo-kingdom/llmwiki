## Context

当前 session 归档已实现 Review 实体与状态机（`planning → ready_for_review → approved → applying → succeeded`），但交互分散在独立 Review 页面；Chat 归档后仅显示「去审核」banner。审核通过的 apply 在 `processReviewApplyJob` 中直接调用 `repo.AddCommit` 写入 main workspace，未使用 worktree 隔离。

并行 ingest job 已有 worktree + merge 基础设施（`CreateWorktree`、`CommitInWorktree`、`MergeBranch`、LLM 冲突解决），但 review apply 未接入。

用户决策：
- **Apply 路径**：在 review processor 内独立 worktree（不复用 worker pool / merge queue）
- **UI**：移除 Review 独立页面，Chat 内嵌审阅卡片完成闭环

## Goals / Non-Goals

**Goals:**

- Chat 内完成归档审阅全流程：计划展示、反馈、重规划、确认执行、进度感知
- Review apply 走 worktree → commit → merge main → search index 更新
- apply 成功后 Chat 卡片提供 Timeline diff 入口（merge commit SHA）
- 移除 Review 页面与导航；后端 Review API 保留供 Chat 卡片调用
- 页面刷新后从 session 关联 review 恢复卡片状态

**Non-Goals:**

- 不复用 worker pool 处理 review apply job（避免 apply job 与 raw ingest job 混队）
- 不引入 plan 结构化手工编辑
- 不在本变更中重构 Jobs 页为审阅中心
- 不改变 plan 生成阶段的 LLM 语义

## Decisions

### D1: Chat 内嵌 ArchiveReviewCard 替代 Review 页面

**Decision**: 在 `IngestChat` composer 上方渲染 `ArchiveReviewCard`，绑定 session 的 active review；删除 `ReviewPage` 及 `review` 路由/导航。

**Rationale**: 用户明确要求 Chat 闭环；Review 页与 Chat 分流造成认知跳转。

**Alternatives considered**:
- 保留 Review 页为辅助视图 → 用户要求去掉
- 计划作为消息流 bubble → 操作控件与 archived 会话状态冲突较大

### D2: Review apply 在 review processor 内独立 worktree

**Decision**: 改造 `processReviewApplyJob`：

```text
VCS 启用:
  CreateWorktree(job.ID)
  → pipeline.SetTargetDir(worktreeDir)
  → ApplyFromPlan(...)
  → CommitInWorktree(worktreeDir, commitMsg)
  → MergeBranch(job.ID) + LLM conflict resolve（复用 vcs 包）
  → indexGeneratedWikiFiles（merge 后）
  → RemoveWorktree(job.ID)
  → 记录 merge_commit_sha 到 review

VCS 未启用:
  保持现有直接 ApplyFromPlan + index 路径
```

**Rationale**: review apply 语义独立（基于已批准 plan，非完整 two-step pipeline）；独立路径避免与 raw ingest worker pool 争抢 slot，且 apply job 仍由现有 review apply job 队列触发。

**Alternatives considered**:
- 复用 worker pool → 用户明确拒绝；apply job 类型与 pipeline 入口不同，需额外分支
- approve 请求内同步阻塞 → 长请求超时风险

### D3: 抽取共享 merge 辅助函数

**Decision**: 从 `mergeCompletedJob` 提取 `mergeWorktreeBranch(ctx, repo, jobID, files, llmClient)` 供 review processor 与普通 merger 共用 merge + conflict resolve + index 逻辑。

**Rationale**: 避免 review processor 与 processor 两套 merge 实现漂移。

### D4: merge_commit_sha 持久化到 ingest_reviews

**Decision**: 新增 `merge_commit_sha` 列（nullable），apply 成功且 VCS 启用时写入；`GET /ingest/reviews/{id}` 与 session detail 的 review 摘要均返回该字段。

**Rationale**: Chat 卡片需稳定 diff 链接，不应依赖前端反查 git log。

### D5: Session 恢复 review 卡片

**Decision**: `GET /api/v1/ingest/sessions/{id}` 响应增加 `active_review` 摘要（`review_id`, `status`, `current_plan_version`, `merge_commit_sha`）；Chat 加载 session 时若有 active review 则渲染卡片。

**Rationale**: 避免 `pendingReviewId` 仅存在于组件 local state，刷新后丢失。

### D6: Timeline diff 联动

**Decision**: 成功态卡片显示「查看变更」按钮，导航至 Timeline 并打开 `CommitDiffDialog`（URL query: `?view=timeline&commit=<sha>`）。

**Rationale**: 复用现有 Timeline diff UI，无需新 modal。

## End-to-End Flow

```text
Chat Session
  └─ 点击「归档」
      ├─ 冻结 archive source
      ├─ 创建 review (planning)
      └─ plan job → ready_for_review

ArchiveReviewCard（composer 上方）
  ├─ 展示 plan vN（markdown）
  ├─ 自然语言反馈 → replan → vN+1
  └─ 「确认计划并执行」→ approve → apply job

Review Apply（review processor, 独立 worktree）
  ├─ worktree 中 ApplyFromPlan + commit
  ├─ merge 回 main（LLM 冲突解决）
  ├─ 更新 search index
  └─ review.succeeded + merge_commit_sha

ArchiveReviewCard 成功态
  └─ [查看变更 diff] → Timeline CommitDiffDialog
```

## Risks / Trade-offs

- **[Risk] review apply 与 parallel job merge 并发冲突** → Mitigation: merge 操作均在 main repo 上串行（review apply 内联 merge，不经过 merge queue 但同样调用 `MergeBranch`；git merge 本身有锁）
- **[Risk] 移除 Review 页后无法跨 session 浏览 review** → Mitigation: 可后续在 Jobs 或 session 列表加 review 状态 badge；本变更 scope 外
- **[Risk] worktree 残留** → Mitigation: defer `RemoveWorktree`；失败路径同样清理；复用现有 `recoverStaleJobs` 扫描
- **[Risk] VCS 未启用无 diff 链接** → Mitigation: 卡片显示成功摘要，隐藏 diff 按钮并提示启用版本控制

## Migration Plan

1. 后端：新增 `merge_commit_sha` 列；改造 `processReviewApplyJob`；扩展 session/review API 响应
2. 前端：新增 `ArchiveReviewCard`；改造 `IngestChat`；删除 Review 页/路由/导航/i18n
3. 测试：review apply worktree 集成测；Chat 卡片 E2E；移除 Review 页测试
4. 无数据迁移；现有 in-flight review 继续可用，apply 行为升级

## Open Questions

- merge 与 parallel job merger 同时运行时是否需要全局 merge 锁？（建议首版依赖 git 原生行为，冲突时再加强）
- 是否在 session 列表显示 review 状态 badge？（建议 follow-up）
