## 1. Git 操作封装层 (internal/vcs/)

- [x] 1.1 创建 `internal/vcs/git.go`：定义 `GitRepo` 结构体和核心接口（InitRepo, IsInitialized, AddCommit, Log, Diff, ShowMessage, IsGitAvailable）
- [x] 1.2 实现 `IsGitAvailable()`：通过 `exec.LookPath("git")` 检测 git CLI 可用性，可用时返回版本号
- [x] 1.3 实现 `InitRepo()`：git init + 创建 .gitignore（追加 `.llmwiki/`、`raw/`、`revert/`）+ git add wiki/ + initial commit
- [x] 1.4 实现 `AddCommit()`：git add wiki/ + git commit，构造结构化 commit message（含 META 和 NORMALIZED 分隔符），处理无变更跳过和超大内容截断
- [x] 1.5 实现 `Log()`：`git log --oneline -n {limit}`，解析输出为 CommitEntry 结构体列表
- [x] 1.6 实现 `Diff()`：`git diff {sha}~1 {sha}`，返回 unified diff 字符串；处理 initial commit 的全量 diff
- [x] 1.7 实现 `ShowMessage()`：`git show {sha} --format=%B`，解析 commit message 中的 META 和 NORMALIZED 内容为结构化数据
- [x] 1.8 实现 `IsInitialized()`：检查 workspace 目录下是否存在 .git 目录
- [x] 1.9 编写 `internal/vcs/git_test.go`：覆盖 init、commit、log、diff、parse message 测试，使用临时目录

## 2. 版本控制配置持久化

- [x] 2.1 在 `internal/store/sqlite/app_config.go` 中新增版本控制配置项：`vc_enabled`（bool）、`vc_last_commit`（string）
- [x] 2.2 新增 `GetVCConfig()` 和 `SetVCEnabled(enabled bool)` 方法
- [x] 2.3 编写配置读写的单元测试

## 3. Ingest Job 流程改造

- [x] 3.1 修改 `internal/ingest/processor.go` 的 `processNext()`：pipeline 成功后插入 git commit 阶段
- [x] 3.2 在 `JobProcessor` 结构体中注入 `*vcs.GitRepo`（可为 nil 表示未启用）
- [x] 3.3 实现 commit message 构造函数：从 NormalizedSource 提取内容，生成结构化 commit message
- [x] 3.4 实现错误分类：pipeline 失败标记 `pipeline_failed`，commit 失败标记 `commit_failed`
- [x] 3.5 实现 retry 分支逻辑：`commit_failed` 时跳过 pipeline 直接重试 git commit
- [x] 3.6 处理 git repo 为 nil（版本控制未启用）时跳过 commit 阶段
- [x] 3.7 编写 processor 改造的集成测试：验证 commit 成功/失败/跳过三种路径

## 4. Rollback Job 实现

- [x] 4.1 在 `internal/ingest/` 下新增 `rollback.go`：定义 `RollbackContext` 结构体（Diff、NormalizedContent、AffectedFiles）
- [x] 4.2 实现 `buildRollbackPrompt()`：构造包含 diff + source content + 当前受影响文件内容的 LLM prompt
- [x] 4.3 实现 `executeRollback()`：调用 LLM pipeline 生成回滚内容，解析输出写入 wiki 文件
- [x] 4.4 在 `processor.go` 的 `processNext()` 中增加 `input_type == 'rollback'` 分支路由
- [x] 4.5 实现源文件归档逻辑：检查 raw/sources/ 中对应文件是否存在，存在则移动到 `revert/{short-sha}-{filename}`
- [x] 4.6 编写 rollback 流程的单元测试：prompt 构造、文件移动、LLM 输出解析

## 5. 后端 API

- [x] 5.1 新增 `internal/api/vcs.go`：版本控制初始化端点 `POST /api/v1/vcs/init`
- [x] 5.2 新增 `GET /api/v1/vcs/status`：返回版本控制状态（enabled、commit count、git available）
- [x] 5.3 新增 `POST /api/v1/vcs/disable`：设置 vc_enabled=false
- [x] 5.4 新增 `GET /api/v1/vcs/log`：返回 commit 列表（支持 limit 参数）
- [x] 5.5 新增 `GET /api/v1/vcs/diff/{sha}`：返回指定 commit 的 diff
- [x] 5.6 新增 `POST /api/v1/ingest/rollback`：创建 rollback job（验证 commit SHA、类型、版本控制状态）
- [x] 5.7 在 `internal/server/server.go` 中注册所有新路由
- [x] 5.8 编写 API 端点的集成测试

## 6. Workspace 初始化适配

- [x] 6.1 修改 workspace init 命令（如涉及 `llmwiki init`）：创建 `revert/` 目录
- [x] 6.2 确认 `internal/watcher/watcher.go` 的 ignoreDirs 包含 `revert` 目录
- [x] 6.3 验证 reindex 流程正确处理 git checkout 导致的文件批量变化（新增/修改/删除）

## 7. 前端：版本控制 Settings UI

- [x] 7.1 在前端类型文件中新增 `VCStatus` 类型定义（enabled、commitCount、gitAvailable）
- [x] 7.2 在 `lib/api.ts` 中新增版本控制 API 调用函数（initVC、getVCStatus、disableVC、getVCLog、getVCDiff、createRollback）
- [x] 7.3 在 Settings 页面新增 "Version Control" 区域组件：
  - 未启用状态：显示 [Enable Version Control] 按钮，git 不可用时 disabled
  - 已启用状态：显示 Active 标记、commit 总数、追踪/排除信息、[View History] 和 [Disable] 按钮
- [x] 7.4 实现启用/禁用操作：调用 API + loading 状态 + 成功后刷新状态

## 8. 前端：Timeline 页面

- [x] 8.1 创建 `TimelinePage.tsx` 页面组件：commit 列表展示（按时间倒序）
- [x] 8.2 创建 `CommitEntry.tsx` 条目组件：展示 subject、时间、变更文件数、[View Diff] 和 [Rollback] 按钮
- [x] 8.3 创建 `DiffModal.tsx` 模态框组件：展示 unified diff，支持 markdown 语法高亮
- [x] 8.4 实现 [Rollback] 确认对话框：说明回滚影响，Confirm / Cancel 按钮
- [x] 8.5 实现 commit 列表的 lazy loading（初始加载 50 条，滚动加载更多）
- [x] 8.6 处理空状态：版本控制未启用 → 提示去 Settings 启用；无 commit → 显示空状态提示
- [x] 8.7 在全局导航中添加 Timeline Tab（版本控制启用时显示）

## 9. 联调与端到端验证

- [x] 9.1 端到端测试：启用版本控制 → ingest 文件 → 验证 git commit 产生 → Timeline 展示
- [x] 9.2 端到端测试：Timeline 中查看 diff → 触发 rollback → 验证 wiki 文件变化 → 新的 rollback commit 产生
- [x] 9.3 端到端测试：rollback 后 raw 文件移动到 revert/ 目录
- [x] 9.4 端到端测试：pipeline 失败 + retry → commit 失败 + retry 各自独立工作
- [x] 9.5 端到端测试：版本控制未启用时 ingest 正常工作（无 git commit 阶段）
