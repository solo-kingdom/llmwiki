## Why

当前 ingest job 严格串行执行：一个 goroutine 轮询，数据库层 `idx_ingest_one_running` 唯一索引保证同一时间最多一个 running job。这导致多个上传文档必须排队等待，LLM 调用（占 95%+ 时间）无法并行，吞吐量低。

## What Changes

引入 git worktree 隔离机制，让多个 job 并行执行 LLM pipeline，完成后串行合并回 main 分支。冲突由 LLM 语义合并解决。

### 核心模型

```
当前：Job → 排队 → 串行执行（claim → pipeline → write wiki/ → git commit）

改为：
Job → 排队 → 并行 claim
              → git worktree 创建隔离环境
              → 在 worktree 中执行 pipeline（LLM 分析、生成、写入）
              → git commit 到 job 分支
              → 提交到 Merge Queue
              → 串行 merge 回 main（冲突由 LLM 解决）
              → 更新 search index
              → 清理 worktree
```

### 执行模型

- Worker Pool：可配置并发数（默认 3），多个 goroutine 并行 claim 和执行 job
- Merge Queue：串行合并队列，保证 main 分支状态始终一致
- 降级：VCS 未启用时回退到串行执行

### 合并策略

- `git merge job/<id>`：无冲突时 fast-forward
- 有冲突时：提取冲突文件的 ours/theirs 内容，调用 LLM 语义合并（复用现有 `DiffMergeBody` / `MergeWikiPage` 能力）
- 合并完成后统一 `git commit`

## Scope

### In Scope

- `internal/vcs/git.go`：新增 worktree 管理（create、remove、merge、conflict 检测）
- `internal/vcs/merge.go`：新增 LLM 冲突解决（复用 ingest 合并能力）
- `internal/ingest/processor.go`：重构为 worker pool + merge queue
- `internal/ingest/pipeline.go`：pipeline 绑定到 worktree 目录
- `internal/ingest/fileblocks.go`：支持写入到 worktree 目录
- `internal/store/sqlite/ingest_jobs_claim.go`：去掉唯一索引约束，允许 N 个并发
- `internal/store/sqlite/migrate_ingest_queue.go`：新增迁移，放宽唯一索引

### Out of Scope

- Web UI 并行度配置界面（先通过配置文件/环境变量）
- Merge 冲突的人工审核流程
- 分布式多节点并行（单进程内并行即可）
- LLM rate limiting 策略（后续可加）

## Capabilities

### Modified Capabilities

- `ingest-pipeline`：pipeline 支持在 worktree 目录中执行
- `version-control-core`：GitRepo 支持 worktree 管理和分支合并
- `versioned-ingest`：job 完成后合并回 main 分支

## Impact

- **Backend**：`internal/vcs/`、`internal/ingest/`、`internal/store/sqlite/`
- **Frontend**：无改动
- **Data**：数据库 schema 变更（放宽唯一索引），需迁移
- **API**：无外部 API 变化

## Dependencies

- 前置要求：VCS（git）已初始化并启用；未启用时自动降级为串行
