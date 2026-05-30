## Why

当前 workspace 的 git 版本控制仅追踪 `wiki/`，Timeline diff 与 ingest 闭环已足够；但用户无法将完整工作环境备份到远程，也无法在新机器上通过 `git clone` + `serve` 快速恢复。需要将「wiki 版本历史」与「环境灾难恢复备份」分离为双轨道，并支持远程 push（自动/手动），同时不把 SQLite 索引库与缓存纳入 git。

## What Changes

- **双轨道 Git 模型**：轨道 A 保持现有行为（仅 `git add wiki/`、ingest/rollback commit、Timeline diff 不变）；轨道 B 新增 `backup:` 快照 commit，追踪工作区配置与可选 `raw/` 素材
- **Settings 导出/导入**：将 `app_config` 中非敏感设置导出到 `.llmwiki/workspace-settings.json`（纳入轨道 B）；API Key 永不写入 git，新环境需用户重填
- **`raw/` 备份**：默认纳入轨道 B；Settings 提供开关 `backup_include_raw`（默认 true）控制是否在 backup commit 中包含 `raw/`
- **远程仓库**：支持配置 `origin`、查看 remote 状态、手动 push、可选「提交后自动 push」开关（默认关）
- **新环境恢复路径**：`git clone` → `llmwiki init`（repair）→ 从导出文件导入 settings → `reindex` → `serve`；Timeline 仍只展示 ingest/rollback 类提交
- **`.gitignore` 精细化**：排除 `index.db`、`cache/`、`worktrees/`；允许备份路径被 track（含条件性 `raw/`）

## Capabilities

### New Capabilities

- `workspace-backup-track`: 轨道 B 备份快照（文件范围、commit 触发时机、`backup:` message 约定、与轨道 A 隔离）
- `workspace-settings-export`: Settings 导出到 git 可追踪文件及 serve/init 时导入，API Key 脱敏/排除策略
- `version-control-remote`: 远程仓库配置、push 状态、自动 push 与手动 push API/UI

### Modified Capabilities

- `version-control-core`: 新增 Push/Remote 操作；`.gitignore` 规则扩展；backup 路径 add 逻辑
- `workspace-management`: init/repair 时 `.gitignore` 与可选 `raw/` 追踪策略；新环境 settings 导入钩子
- `version-settings-ui`: Settings 版本控制区扩展（remote URL、auto-push、backup raw 开关、手动 push、备份状态）
- `settings-api`: 新增 backup/remote 相关配置键；settings 变更触发导出
- `timeline-ui`: 提交列表默认过滤为轨道 A（ingest/rollback），不展示 `backup:` 快照
- `versioned-ingest`: ingest commit 成功后可选触发 push（受 auto-push 开关约束）

## Impact

- **Go**: `internal/vcs/`（Push、Remote、BackupCommit）；`internal/api/vcs.go`；`internal/ingest/processor.go`；`internal/store/sqlite/app_config.go`；`cmd/llmwiki/init.go`；新增 settings 导出/导入模块
- **前端**: `SettingsPage.tsx`、`lib/api.ts`、`types.ts`、i18n
- **OpenSpec**: `version-control-core`、`workspace-management`、`version-settings-ui` 等 delta specs
- **用户工作流**: 需配置 git 认证（SSH/credential helper）；API Key 迁移后需重填
