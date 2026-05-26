## 1. 后端数据模型与 API

- [x] 1.1 为 `ingest_reviews` 新增 `merge_commit_sha` 列及 store 读写方法
- [x] 1.2 扩展 `GET /api/v1/ingest/sessions/{id}` 响应：增加 `active_review` 摘要字段
- [x] 1.3 扩展 `GET /api/v1/ingest/reviews/{id}` 响应：返回 `merge_commit_sha`
- [x] 1.4 编写 API 单测：session active_review 恢复、review merge_commit_sha 返回

## 2. Review Apply Worktree 执行

- [x] 2.1 从 `mergeCompletedJob` 抽取共享 merge 辅助函数（merge + LLM 冲突解决 + index）
- [x] 2.2 改造 `processReviewApplyJob`：VCS 启用时走 CreateWorktree → ApplyFromPlan → CommitInWorktree → MergeBranch
- [x] 2.3 merge 成功后写入 `merge_commit_sha` 到 review 记录
- [x] 2.4 失败路径清理 worktree；VCS 未启用保持直接写 main 降级
- [x] 2.5 编写 review apply worktree 集成测（含 merge 成功与 worktree 清理）

## 3. 前端 ArchiveReviewCard 组件

- [x] 3.1 新增 `ArchiveReviewCard` 组件：状态轮询、计划 markdown 渲染、版本切换
- [x] 3.2 实现反馈提交、重新规划、确认执行按钮及 loading/error 态
- [x] 3.3 成功态展示 merge commit diff 入口；失败态展示重新规划
- [x] 3.4 集成到 `IngestChat`：替换现有「去审核」banner；从 session `active_review` 恢复
- [x] 3.5 更新 i18n（zh/en）：审阅卡片文案，移除 Review 页相关文案

## 4. 移除 Review 独立页面

- [x] 4.1 删除 `ReviewPage.tsx` 及 Workbench `review` 视图路由
- [x] 4.2 从 `WorkbenchLayout` 导航移除 Review 入口
- [x] 4.3 清理 `wiki-routes`、测试中对 `review` 视图的引用
- [x] 4.4 移除或更新 Review 页相关前端测试

## 5. Timeline Diff Deep Link

- [x] 5.1 `TimelinePage` 支持 `?commit=<sha>` query 自动打开 `CommitDiffDialog`
- [x] 5.2 ArchiveReviewCard「查看变更」导航至 Timeline deep link
- [x] 5.3 编写 timeline deep link 前端测试

## 6. 回归与验证

- [x] 6.1 更新 `ingest-chat.test.tsx`：归档后展示 ArchiveReviewCard 而非跳转 Review
- [x] 6.2 回归：归档 → 审阅 → 确认 → Timeline diff 完整路径
- [x] 6.3 回归：VCS 未启用时归档审阅仍可用（无 diff 链接）
