## Context

llmwiki 在 workspace 根目录维护独立 git 仓库。轨道 A（现有）仅 `git add wiki/`，驱动 ingest/rollback commit 与 Timeline diff。配置与索引存于 `.llmwiki/index.db`（`app_config`、provider API Key），不在 git 中。历史设计（`default-vc-on-init`）明确排除远程 push 与 raw 追踪；用户现需在**不破坏 Timeline 语义**的前提下，用 git 做环境备份并可选同步到 remote。

用户已确认：
- `raw/` **默认**纳入备份，Settings 提供开关关闭
- Settings **导出为文件**纳入备份；**API Key 不导出**，新环境重填
- 自动 push **默认关**；支持手动 push（探索阶段共识，纳入本变更）

## Goals / Non-Goals

**Goals:**

- 双轨道：轨道 A 行为与 UI diff **不变**；轨道 B `backup:` 快照用于灾难恢复
- 新环境：`git clone` → `init` repair → 导入 settings 文件 → `reindex` → `serve` 可恢复 wiki 检索与（重填 Key 后）ingest
- 远程：`git remote` 配置、状态查询、手动 push、可选 commit 后 auto-push
- Settings 变更时导出 `.llmwiki/workspace-settings.json` 并触发 backup commit

**Non-Goals:**

- 不把 `index.db`、`cache/`、`worktrees/` 纳入 git
- MVP 不做 `git pull`/自动 merge；non-fast-forward 报错并提示 CLI
- 不把 API Key 写入 git；不备份 ingest job / chat session 历史
- 不改变 worktree 并行 merge 语义

## Decisions

### Decision 1: 双轨道 commit，而非扩大 `AddCommit` 范围

**选择**: `AddCommit` 仍只 `git add wiki/`；新增 `BackupCommit(paths)` 生成 `backup: snapshot` commit。

**理由**: Timeline、`VCDiff`、rollback 均假设 commit 主体为 wiki ingest。混入 settings/raw 会导致 diff 噪声与 rollback 语义混乱。

**替代方案**: 单次 commit 同时 add wiki+config — 已否决。

### Decision 2: 备份路径集合

**固定纳入轨道 B**（有变更时 add）:
- `purpose.md`, `rules.md`
- `.llmwiki/prompts.yaml`（存在时）
- `.llmwiki/workspace-settings.json`（导出产物）
- `.gitignore`

**条件纳入**:
- `raw/` — 当 `app_config.backup_include_raw` 为 true（**默认 true**）

**始终排除**:
- `.llmwiki/index.db`, `.llmwiki/cache/`, `.llmwiki/worktrees/`, `revert/`, `wiki/`（由轨道 A 负责）

### Decision 3: `.gitignore` 精细化

**选择**: init/repair 写入细粒度规则，替代整目录 `.llmwiki/` 排除：

```gitignore
.llmwiki/cache/
.llmwiki/index.db
.llmwiki/worktrees/
revert/
```

`raw/` **不**写入默认 gitignore（因默认备份 raw）。当用户关闭 `backup_include_raw` 时，系统追加 `raw/` 到 gitignore（幂等）。

### Decision 4: Settings 导出格式与导入时机

**选择**: `.llmwiki/workspace-settings.json`，`version: 1`，包含 `GetSettings` 暴露的非敏感字段；**排除** `provider_instances` / API Key。

**导出触发**: `PUT /settings` 成功、手动「立即备份」、auto-push 前（若有待推送 backup）。

**导入触发**: `llmwiki init` repair 创建新 DB 后；`serve` 启动时若 `app_config` 为空且文件存在。

**API Key**: 导入后 provider 表为空，UI 提示重新配置。

### Decision 5: 远程与 push

**选择**: remote URL 存 git（`git remote add/set-url origin`）；`vc_auto_push` 存 `app_config`（默认 `false`）。

**push 时机**:
1. ingest/rollback 轨道 A commit 成功后，若 `vc_auto_push` → `git push`
2. backup commit 成功后，若 `vc_auto_push` → `git push`
3. `POST /api/v1/vcs/push` 手动

**失败策略**: push 失败不翻转 job 状态；记 activity + `VCStatus.last_push_error`。

**认证**: 依赖系统 git（SSH agent / credential helper），错误信息本地化提示。

### Decision 6: Timeline 过滤

**选择**: `GET /api/v1/vcs/log` 默认 `--grep` 等价过滤 subject 匹配 `^(ingest|rollback):`；backup commit 不出现在 Timeline。

**理由**: 用户明确要求界面 diff 继续保持 wiki 语义。

### Decision 7: backup 触发策略

**选择**:
- Settings `PUT` 成功 → 导出 JSON → `BackupCommit`
- 提供 `POST /api/v1/vcs/backup` 手动快照
- 可选：ingest 成功后若 `backup_include_raw` 且 raw 有变，可合并到同一 backup 周期（实现简单起见：ingest 后不自动 backup，仅 settings/手动/push 前）

**简化 MVP**: ingest 成功**不**自动 backup（避免大 raw 每次 ingest push 巨库）；用户依赖 settings 保存与手动 backup + auto-push。

## Risks / Trade-offs

- **[Risk] raw 默认备份导致 remote 体积膨胀** → Settings 默认开但明确提示；关闭开关追加 `raw/` 到 gitignore
- **[Risk] push 认证失败** → 不阻塞 ingest；Settings 展示 last error
- **[Risk] settings 文件与 DB 双写不一致** → 以 DB 为运行时真相；文件为备份源，导入仅于空 DB 或显式 repair
- **[Risk] 现有 workspace `.gitignore` 含 `.llmwiki/`** → repair 迁移：追加 negation 规则或 rewrite 细粒度条目（init repair 路径）

## Migration Plan

1. `llmwiki init` repair：升级 workspace `.gitignore`；若存在旧规则则迁移
2. 首次打开 Settings 保存：生成 `workspace-settings.json` + 可选首次 `backup:` commit
3. 已有 remote 用户：手动配置 `origin` 或 UI 设置 URL
4. 回滚：关闭 `vc_auto_push`；backup 提交保留在历史中，不影响 wiki 轨道

## Open Questions

- （已关闭）raw 是否默认备份 → **是，可关**
- （已关闭）API Key → **不导出，重填**
- backup 是否在每次 ingest 后自动运行 → **MVP 否**，降低 remote 压力；若后续需要可加 `backup_after_ingest` 开关
