## Overview

将 ingest job 从严格串行改为 git worktree 隔离的并行执行模型。多个 job 在独立 worktree 中并行运行 LLM pipeline，完成后串行合并回 main 分支，冲突由 LLM 语义合并解决。

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        JobProcessor                                  │
│                                                                      │
│   ┌──────────────────────────────────────────────────────┐           │
│   │              Worker Pool (N workers)                  │           │
│   │                                                      │           │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │           │
│   │  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  ...      │           │
│   │  │          │  │          │  │          │           │           │
│   │  │ claim    │  │ claim    │  │ claim    │           │           │
│   │  │ worktree │  │ worktree │  │ worktree │           │           │
│   │  │ pipeline │  │ pipeline │  │ pipeline │           │           │
│   │  │ commit   │  │ commit   │  │ commit   │           │           │
│   │  └───┬──────┘  └───┬──────┘  └───┬──────┘           │           │
│   │      │             │             │                   │           │
│   └──────┼─────────────┼─────────────┼───────────────────┘           │
│          │             │             │                               │
│          ▼             ▼             ▼                               │
│   ┌──────────────────────────────────────────────────────┐           │
│   │              Merge Queue (串行)                       │           │
│   │                                                      │           │
│   │   for each completed job:                             │           │
│   │     git merge job/<id>                                │           │
│   │     ├── no conflict → fast-forward ✓                  │           │
│   │     └── conflict → LLM resolve → commit ✓            │           │
│   │     update search index                               │           │
│   │     cleanup worktree                                  │           │
│   └──────────────────────────────────────────────────────┘           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Detailed Design

### 1. Git Worktree 管理 (`internal/vcs/git.go`)

新增方法到 `GitRepo`：

```go
// CreateWorktree 创建独立工作目录，基于当前 main 分支
func (r *GitRepo) CreateWorktree(jobID string) (worktreeDir string, err error)

// CommitInWorktree 在 worktree 中 stage + commit
func (r *GitRepo) CommitInWorktree(worktreeDir, message string) (sha string, err error)

// MergeBranch 将 job 分支合并回 main，返回冲突文件列表
func (r *GitRepo) MergeBranch(jobID string) (conflicts []string, err error)

// GetConflictContent 获取冲突文件的 ours/theirs 内容
func (r *GitRepo) GetConflictContent(jobID string, filePath string) (ours, theirs string, err error)

// ResolveAndCommit 解决冲突后完成合并提交
func (r *GitRepo) ResolveAndCommit(jobID string, resolved map[string]string, message string) error

// RemoveWorktree 清理 worktree 和分支
func (r *GitRepo) RemoveWorktree(jobID string) error
```

**Worktree 目录结构：**
```
.llmwiki/worktrees/
  <job-id>/          ← git worktree 检出目录
    wiki/            ← job 的 wiki 文件（pipeline 写入这里）
```

**分支命名：** `job/<job-id>`

### 2. LLM 合并冲突解决 (`internal/vcs/merge.go`)

新增模块，复用 `internal/ingest/merge.go` 的能力：

```go
// ResolveMergeConflicts 用 LLM 解决所有冲突文件
func ResolveMergeConflicts(ctx context.Context, repo *GitRepo, jobID string, mc *MergeContext) error
```

**合并流程（逐冲突文件）：**

```
1. git merge job/<id> → 获取冲突文件列表
2. for each conflict file:
   a. 读取 ours (main) 和 theirs (job branch) 的完整内容
   b. 如果文件有 frontmatter → mergeFrontmatter() + LLM body merge
   c. 如果纯文本 → LLM 全文合并
   d. 写入解决后的内容到 main worktree
3. git add + git commit 完成合并
```

**LLM 合并 prompt（扩展自现有 `mergeBodyLLM`）：**

```
"以下 wiki 页面存在合并冲突，来自两个独立的整理任务。
请合并为一个完整、一致的版本，保留两份修改中所有有价值的信息，
消除重复，保持结构一致。

版本 A (已合并的 wiki):
{ours}

版本 B (新任务的修改):
{theirs}"
```

复用现有能力：
- `splitWikiPage()` → frontmatter + body 分离
- `mergeFrontmatter()` → frontmatter 规则合并
- `DiffMergeBody()` / `mergeBodyLLM()` → body 合并（带 70% 长度守卫）

### 3. Worker Pool 重构 (`internal/ingest/processor.go`)

```go
type JobProcessor struct {
    db           *sqlite.DB
    workspace    string
    maxWorkers   int           // 可配置，默认 3
    workers      sync.WaitGroup
    mergeQueue   chan *completedJob  // 串行合并通道
    // ...
}

type completedJob struct {
    jobID       string
    worktreeDir string
    files       []string     // 生成的 wiki 文件列表
    recorder    JobRecorder
}
```

**执行模型：**

```
Start():
  1. 启动 maxWorkers 个 worker goroutine
  2. 启动 1 个 merger goroutine（消费 mergeQueue）

worker():
  for {
    job := claimNextJob()
    if job == nil { sleep; continue }

    worktree := repo.CreateWorktree(job.ID)
    pipeline.ExecuteIn(worktree)    // LLM 分析+生成，写入 worktree
    repo.CommitInWorktree(worktree)

    mergeQueue <- completedJob{...} // 提交到合并队列
  }

merger():
  for job := range mergeQueue {
    repo.MergeBranch(job.jobID)
    if conflicts {
      ResolveMergeConflicts(ctx, repo, job.jobID, mc)
    }
    repo.RemoveWorktree(job.jobID)
    indexGeneratedWikiFiles(job.files)
    markJobSucceeded(job.jobID)
  }
```

### 4. Pipeline 绑定到 Worktree

`Pipeline` 当前直接操作 `workspace/wiki/`。改为接受可选的 `targetDir`：

```go
type Pipeline struct {
    workspace string
    targetDir string  // 默认 = workspace，worktree 模式下 = worktree 路径
    // ...
}

// wikiDir() 返回实际 wiki 目录
func (p *Pipeline) wikiDir() string {
    if p.targetDir != "" {
        return filepath.Join(p.targetDir, "wiki")
    }
    return filepath.Join(p.workspace, "wiki")
}
```

影响：
- `ApplyWikiBlocks` → 写入 `wikiDir()` 而非固定路径
- `readExistingWikiPages` → 从 `wikiDir()` 读取
- `IngestNormalized` 中的文件操作 → 基于 `wikiDir()`

### 5. 数据库层变更

**迁移：放宽唯一索引**

```sql
-- 旧：最多 1 个 running
CREATE UNIQUE INDEX idx_ingest_one_running ON ingest_jobs(status) WHERE status = 'running';

-- 新：最多 N 个 running（不再用索引约束，改用应用层限制）
DROP INDEX IF EXISTS idx_ingest_one_running;
```

**ClaimNext 逻辑调整：**

```go
func (d *DB) ClaimNextIngestJob(runnerID string) (*IngestJob, error) {
    tx, err := d.db.Begin()
    // Step 1: 恢复过期 job（不变）
    // Step 2: 检查 active running 数量
    var active int
    tx.QueryRow(`SELECT COUNT(*) FROM ingest_jobs
        WHERE status = 'running' AND heartbeat_at != ''
        AND heartbeat_at >= datetime('now', '-120 seconds')`).Scan(&active)
    // Step 3: 应用层限制（而非索引约束）
    if active >= maxConcurrentJobs {  // 从配置读取，默认 3
        return nil, nil
    }
    // Step 4: claim（不变）
}
```

### 6. 配置

新增配置项（存入 `app_config` 表）：

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `job_max_concurrent` | `3` | 最大并行 job 数 |
| `job_parallel_enabled` | `true` | 是否启用并行（VCS 未启用时自动降级） |

### 7. 降级策略

```
┌─────────────────────────────────────────────┐
│  VCS 状态        →  执行模式                 │
├─────────────────────────────────────────────┤
│  VCS 启用 + git 可用 →  并行（worktree）     │
│  VCS 未启用          →  串行（保持现状）      │
│  git 不可用          →  串行（保持现状）      │
│  job_parallel_enabled=false → 串行           │
└─────────────────────────────────────────────┘
```

### 8. 错误处理

| 场景 | 处理 |
|------|------|
| worktree 创建失败 | job 标记 failed，error_code = `worktree_failed` |
| pipeline 在 worktree 中失败 | job 标记 failed，清理 worktree |
| merge 冲突 + LLM 合并失败 | 保留冲突状态，job 标记 `merge_conflict`，可重试 |
| merge 过程中进程崩溃 | worktree 残留，下次启动时 `recoverStaleJobs` 清理 |

### 9. Search Index 更新时机

合并完成后（merger goroutine 中）统一更新 search index，而非每个 job 写入后立即更新。保证 index 反映的是合并后的最终 main 状态。

## Migration Path

1. **Phase 1**：重构 processor 为 worker pool，worktree 管理，串行合并 + LLM 冲突解决
2. **Phase 2**（可选）：前端配置界面，merge conflict 审核流程
