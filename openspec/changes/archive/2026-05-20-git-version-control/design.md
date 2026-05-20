## Context

llmwiki 的 workspace 目录结构为 `wiki/`（LLM 生成的 wiki 页面）、`raw/sources/`（原始上传文件）、`.llmwiki/`（SQLite 索引和缓存）。当前 ingest job 处理流程为：normalize → pipeline (analyze + generate) → 写入 wiki 文件 → 标记 job succeeded，没有任何版本记录。

用户无法查看历史改动，无法回滚某次摄入的结果。LLM 输出可能不准确，但一旦写入就无法撤销。

核心约束：
- `wiki/` 是可变产出（后续 ingest 可能修改已有页面）
- `raw/sources/` 是不可变素材（写入后不修改）
- `.llmwiki/index.db` 是派生索引，可从文件系统重建
- ingest job 已经通过 `claimNextJob` 实现逻辑串行

## Goals / Non-Goals

**Goals:**
- 为 wiki/ 产出提供完整的 git 版本历史
- 每个 ingest job 完成后自动提交，commit message 包含 normalized source content
- 支持 LLM 智能回滚：基于 diff + source content 让 LLM 理解语义后反向操作
- 回滚后的源文件归档到 revert/ 目录
- Settings 页面提供版本控制开关
- Timeline 页面展示历史并支持 rollback 操作

**Non-Goals:**
- 不支持 git branch（始终在 main/master 上操作）
- 不支持远程仓库同步（push/pull）
- 不实现用户自行编辑 wiki 后的手动 commit（仅自动 commit）
- 不处理 raw 文件的版本管理（不可变，无需版本化）
- 不支持部分回滚（每次回滚针对一个完整 commit）
- 不在 commit 中存储原始二进制文件（只存 normalized 纯文本）
- 不使用 go-git 纯 Go 库（功能不够完善，使用 git CLI）

## Decisions

### Decision 1: os/exec 调用 git CLI

**选择**: 使用 `os/exec` 调用系统 git 命令

**替代方案**:
- go-git（纯 Go）：部分 edge case 有 bug，大仓库性能差，diff 解析需手写
- libgit2 bindings：CGO 依赖，与现代c.org/sqlite 理念冲突

**理由**:
- 需要的操作简单：init, add, commit, log, diff, show
- git CLI 功能完整，行为与用户预期一致
- git binary 在 Linux/macOS 通常预装
- diff/log 输出解析比手写纯 Go 实现可靠

**接口设计**:
```go
// internal/vcs/git.go
type GitRepo struct {
    workDir string  // workspace 根目录
}

func InitRepo(workDir string) (*GitRepo, error)
func (r *GitRepo) IsInitialized() bool
func (r *GitRepo) AddCommit(message string) (string, error)  // 返回 commit SHA
func (r *GitRepo) Log(limit int) ([]CommitEntry, error)
func (r *GitRepo) Diff(commitSHA string) (string, error)
func (r *GitRepo) ShowMessage(commitSHA string) (string, error)
```

### Decision 2: Commit message 结构化格式

**选择**: 使用分隔符格式的 commit message

```
ingest: {source_filename}

---META---
job_id: {uuid}
source: {source_filename}
source_type: {input_type}
---NORMALIZED-START---
{normalized source content，纯文本}
---NORMALIZED-END---
```

**替代方案**:
- Git notes：不随正常 push/fetch 转移，容易丢失
- 独立元数据文件（.ingest-meta/）：增加 git 追踪复杂度
- JSON 格式 commit message：可读性差

**理由**: 自包含、可解析、人类可读。git log 直接看到 source filename，需要回滚时解析出 normalized content。

### Decision 3: Rollback 作为普通 job 类型

**选择**: 在 ingest_jobs 表中复用现有表结构，通过 `input_type = 'rollback'` 区分

**替代方案**:
- 新建 rollback_jobs 表：需要合并两张表的队列调度
- 完全独立的 rollback 流程：绕过 job queue，并发安全问题

**理由**: rollback 和 ingest 共享串行队列保证并发安全。复用 job 状态机（queued → running → succeeded/failed）。rollback 特有字段利用 `source_ref` 存 commit SHA，`source_path` 存 rollback 元数据路径。

### Decision 4: Pipeline 失败与 Commit 失败分离重试

**选择**: 在 job 处理流程中区分两个阶段，记录失败阶段信息

```
processNext():
  1. claim job
  2. run pipeline → 写入 wiki 文件
     失败 → error_code 标记 "pipeline_failed"，retry 时重跑 pipeline
  3. git add + commit
     失败 → error_code 标记 "commit_failed"，retry 时只重跑 git commit
  4. 标记 succeeded
```

**理由**: pipeline 成功但 commit 失败时，wiki 文件已写入磁盘。重跑 pipeline 会浪费 LLM 调用。只需重新 git add + commit 即可。

### Decision 5: 仅追踪 wiki/ 目录

**选择**: .gitignore 排除 `.llmwiki/`、`raw/`、`revert/`

**理由**:
- `raw/` 不可变，无需版本管理；内容已嵌入 commit message（normalized 形式）
- `.llmwiki/` 是派生索引，可重建
- `revert/` 是归档区，不属于 wiki 产出
- 最小化 git 仓库体积，避免二进制膨胀

### Decision 6: 启用版本控制时创建 initial commit

**选择**: Settings 启用时执行 `git init` + `.gitignore` + `git add wiki/` + `git commit -m "initial: existing wiki"`

**理由**: 提供干净的基线。之后每个操作都有清晰的增量 diff，第一个 rollback 也有对比基准。

## Risks / Trade-offs

**[Risk] git 未安装** → 启用版本控制前检测 git 是否可用，UI 提示安装

**[Risk] 大型 PDF normalized content 塞入 commit message** → normalized 后通常是 KB 级文本；如果超过 1MB 限制，截断并记录 warning

**[Risk] git checkout 恢复文件后 watcher 触发批量 reindex** → 回滚产生的文件变化通过 watcher 的 cooldown 机制（4s）自然合并；reindex 本身已支持增量更新

**[Risk] 连续回滚产生语义冲突** → LLM 每次回滚都看到完整上下文（当前 wiki 状态 + diff + source），自行处理冲突；不保证完美，但比机械 revert 更可靠

**[Risk] git 仓库体积增长** → 仅追踪文本 wiki 文件，增长缓慢；后期可提供 GC 按钮

**[Trade-off] 依赖外部 git CLI** → 换取功能完整性和可靠性；大多数环境已有 git
