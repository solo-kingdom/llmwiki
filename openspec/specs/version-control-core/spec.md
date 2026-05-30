## MODIFIED Requirements

### Requirement: Git 仓库初始化
系统 SHALL 支持在 workspace 目录中初始化 git 仓库。轨道 A 初始 commit 仅包含 `wiki/`；`.gitignore` SHALL 使用细粒度规则排除 `.llmwiki/cache/`、`.llmwiki/index.db`、`.llmwiki/worktrees/`、`revert/`，且默认不排除 `raw/`（供轨道 B 默认备份）。

#### Scenario: 首次初始化
- **WHEN** 系统在 workspace 目录执行 git init
- **THEN** SHALL 创建 `.git/` 目录，生成细粒度 `.gitignore`，并创建 initial commit 包含当前 `wiki/` 文件
- **AND** initial commit SHALL NOT 包含 `raw/` 或 settings 导出文件（由后续 backup 轨道处理）

#### Scenario: 已有 .gitignore 追加
- **WHEN** workspace 中已存在 `.gitignore` 文件
- **THEN** SHALL 仅追加不存在的必要排除条目，不覆盖用户已有内容
- **AND** repair 时 SHALL 迁移旧的整目录 `.llmwiki/` 排除为细粒度规则（若存在）

#### Scenario: workspace 已有 git 仓库
- **WHEN** workspace 中已存在 `.git/` 目录
- **THEN** SHALL 跳过初始化，验证 `.gitignore` 包含必要细粒度排除条目

#### Scenario: git 未安装
- **WHEN** 系统检测到 git CLI 不可用
- **THEN** SHALL 返回明确错误，提示用户安装 git

## ADDED Requirements

### Requirement: Git 备份 commit 操作
系统 SHALL 提供 `BackupCommit` 操作，仅 add 备份路径集合（见 `workspace-backup-track`），commit message 为 `backup: snapshot`。

#### Scenario: 备份 commit 与 wiki add 分离
- **WHEN** 调用 `BackupCommit`
- **THEN** SHALL NOT 执行 `git add wiki/`

### Requirement: Git push 操作
系统 SHALL 封装 `git push` 到已配置 `origin` 的当前分支，并返回错误详情。

#### Scenario: 无 remote 时 push 失败
- **WHEN** 未配置 `origin` 且调用 push
- **THEN** SHALL 返回可区分的错误类型供 API 映射为 400

### Requirement: Git log 查询过滤
系统 SHALL 支持查询时排除 `backup:` 前缀的 commit，供 Timeline 使用。

#### Scenario: Timeline 用 log 过滤
- **WHEN** API 请求版本历史供 Timeline 展示
- **THEN** SHALL 仅返回 subject 匹配 ingest/rollback 模式的 commit（不含 `backup:`）

### Requirement: Git diff 查询范围不变
`Diff(commitSHA)` SHALL 继续返回该 commit 的 unified diff；对 `backup:` commit 的 diff API 可供调试，但 Timeline UI 不调用。

#### Scenario: ingest commit diff 不变
- **WHEN** 请求 ingest commit 的 diff
- **THEN** SHALL 行为与变更前一致（parent 对比）
