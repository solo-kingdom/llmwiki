## Tasks

### Task 1: 数据库迁移 — 放宽唯一索引 ✅
- [x] 删除 `idx_ingest_one_running` 唯一索引
- [x] 新增配置项 `job_max_concurrent`（默认 3）和 `job_parallel_enabled`（默认 true）
- [x] 修改 `ClaimNextIngestJob`：用应用层计数限制并发数，替代索引约束
- [x] 测试：验证可同时 claim 多个 job，达到上限后拒绝

**Files:** `internal/store/sqlite/migrate_ingest_queue.go`, `internal/store/sqlite/ingest_jobs_claim.go`

### Task 2: Git Worktree 管理方法 ✅
- [x] 在 `GitRepo` 新增 `CreateWorktree`、`CommitInWorktree`、`MergeBranch`、`GetConflictContent`、`ResolveAndCommit`、`RemoveWorktree`
- [x] Worktree 存放于 `.llmwiki/worktrees/<job-id>/`，分支命名 `job/<job-id>`
- [x] 处理 edge case：worktree 目录已存在、分支已存在、清理残留
- [x] 测试：worktree 创建/提交/合并/清理的完整生命周期

**Files:** `internal/vcs/git.go`, `internal/vcs/git_test.go`

### Task 3: LLM 冲突合并模块 ✅
- [x] 新增 `internal/vcs/merge.go`，实现 `ResolveMergeConflicts`
- [x] 解析 `git merge` 冲突文件列表
- [x] 逐文件提取 ours/theirs 内容，调用 LLM 合并（复用 `ingest/merge.go` 的 `MergeWikiPage` / `DiffMergeBody` 逻辑）
- [x] 解决后写入文件，`git add` + `git commit`
- [x] 测试：模拟冲突场景，验证 LLM 合并输出

**Files:** `internal/vcs/merge.go`, `internal/vcs/merge_test.go`

### Task 4: Pipeline 支持 Worktree 目录 ✅
- [x] `Pipeline` 新增 `targetDir` 字段和 `SetTargetDir` 方法
- [x] 抽取 `wikiDir()` 方法，统一所有 wiki 路径计算
- [x] 修改 `ApplyWikiBlocks` 接受目标目录参数（通过 `effectiveWorkspace()` 传递）
- [x] 修改 `IngestNormalized` 中所有 wiki 路径引用使用 `wikiDir()`
- [x] 测试：验证 pipeline 写入到 worktree 目录而非主 workspace

**Files:** `internal/ingest/pipeline.go`, `internal/ingest/fileblocks.go`, `internal/ingest/pipeline_test.go`

### Task 5: Processor 重构为 Worker Pool + Merge Queue ✅
- [x] `JobProcessor` 新增 `maxWorkers`、`mergeQueue` 字段
- [x] `Start()` 启动 N 个 worker goroutine + 1 个 merger goroutine
- [x] Worker：claim → 创建 worktree → 执行 pipeline → commit → 提交到 mergeQueue
- [x] Merger：消费 mergeQueue → merge 回 main → LLM 解决冲突 → 更新 index → 清理 worktree → 标记 succeeded
- [x] 降级逻辑：VCS 未启用或 `job_parallel_enabled=false` 时回退到串行模式
- [x] Heartbeat 机制不变，每个 worker 独立维护
- [x] 测试：并发提交多个 job，验证并行执行和串行合并

**Files:** `internal/ingest/processor.go`, `internal/ingest/processor_test.go`

### Task 6: 启动时清理残留 Worktree ✅
- [x] `recoverStaleJobs()` 扩展：检测 `.llmwiki/worktrees/` 下的残留目录
- [x] 对比 job 状态：running 但 heartbeat 过期的 job，清理其 worktree
- [x] 正常流程外崩溃的 worktree 清理
- [x] 测试：模拟崩溃后重启，验证残留清理

**Files:** `internal/ingest/processor.go`

### Task 7: 集成测试 ✅
- [x] 端到端测试：提交 3+ 个 job，验证并行执行、串行合并、最终 wiki 状态正确
- [x] 冲突场景测试：两个 job 修改同一文件，验证 LLM 合并结果
- [x] 降级测试：VCS 未启用时回退串行
- [x] 性能对比：串行 vs 并行的执行时间

**Files:** `internal/vcs/git_test.go`, `internal/vcs/merge_test.go`, `internal/ingest/processor_test.go`
