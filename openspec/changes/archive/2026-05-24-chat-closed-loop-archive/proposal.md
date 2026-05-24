## Why

当前 session 归档流程在 Chat 与独立 Review 页面之间分流：用户点击归档后需跳转 Review 页查看计划、反馈与批准，且审核通过后的 apply 直接写入 main workspace，未走 worktree 隔离与 merge 路径，Timeline 无法一致地展示归档变更 diff。用户希望在 Chat 内完成「归档 → 审阅计划 → 确认执行 → 查看 diff」的完整闭环，并移除独立的 Review 页面。

## What Changes

- 在 Ingest Chat 内嵌 **归档审阅卡片（ArchiveReviewCard）**：展示计划版本、自然语言反馈、重新规划、确认执行与执行进度
- 归档成功后 **不再引导跳转 Review 页**；刷新页面后仍可从 session 关联的 review 恢复卡片状态
- **移除 Review 独立页面** 及 Workbench `review` 导航入口（**BREAKING**）
- 审核通过后的 apply 改为在 **review processor 内独立 worktree** 执行：CreateWorktree → ApplyFromPlan → CommitInWorktree → merge 回 main → 更新 search index
- VCS 未启用时降级为直接写 workspace（与现有 parallel job 降级策略一致）
- apply 完成后在 Chat 卡片提供 **Timeline diff 入口**（基于 merge commit SHA）
- Review 后端实体与 API **保留**（供 Chat 卡片调用），仅移除独立 UI

## Capabilities

### New Capabilities

- `chat-archive-review`: Chat 内嵌的归档审阅闭环——计划展示、反馈重规划、确认执行、进度感知与 Timeline diff 联动

### Modified Capabilities

- `ingest-chat-ui`: 归档成功反馈从「跳转 Review」改为内嵌审阅卡片；archived 会话下 composer 禁用但卡片可操作
- `ingest-session-api`: session 详情或 archive 响应需暴露关联 review 状态；apply 完成后返回 merge commit SHA（VCS 启用时）
- `ingest-pipeline`: review apply 阶段改为 worktree 隔离执行并 merge 回 main
- `web-ui`: 移除 Review 页面与导航；markdown 预览要求覆盖 Chat 内嵌计划卡片
- `timeline-ui`: 支持从 Chat 审阅卡片 deep link 打开指定 commit 的 diff

## Impact

- **后端**: `internal/ingest/review_processor.go`（worktree apply + merge）、`internal/vcs/git.go`（复用现有 worktree API）、`internal/api/ingest_review.go`、`internal/api/ingest_session.go`
- **前端**: 新增 `ArchiveReviewCard`；改造 `IngestChat.tsx`；删除 `ReviewPage.tsx` 及 `review` 路由/导航；更新 i18n
- **测试**: 后端 review apply worktree 路径；前端 Chat 卡片交互与 Timeline 链接；移除 Review 页相关测试
- **Breaking**: 移除 `/review` Workbench 视图与 Review 导航 Tab
