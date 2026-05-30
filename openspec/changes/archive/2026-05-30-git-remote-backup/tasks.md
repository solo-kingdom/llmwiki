## 1. VCS 核心与 gitignore 迁移

- [x] 1.1 将 `ensureGitignore` 改为细粒度规则（cache、index.db、worktrees、revert）；init repair 迁移旧 `.llmwiki/` 整目录排除
- [x] 1.2 实现 `BackupCommit`：按 `backup_include_raw` 组装路径并 `backup: snapshot` 提交
- [x] 1.3 实现 `LogIngestOnly`（或 log 过滤参数）排除 `backup:` commit
- [x] 1.4 实现 `SetRemote` / `Push` / `RemoteStatus` 封装与单元测试
- [x] 1.5 `backup_include_raw=false` 时幂等追加 `raw/` 到 `.gitignore`

## 2. Settings 导出/导入

- [x] 2.1 新增 `internal/workspace/settings_export.go`：导出/导入 `workspace-settings.json`（version 1，无 API Key）
- [x] 2.2 `PUT /settings` 成功后调用导出 + `BackupCommit`
- [x] 2.3 `cmd/llmwiki/init.go` 新 DB 路径导入 settings；`serve` 空 config 时导入
- [x] 2.4 `app_config` 增加 `backup_include_raw`（默认 true）、`vc_auto_push`（默认 false）读写

## 3. HTTP API

- [x] 3.1 扩展 `VCStatus`：remote、auto_push、backup_include_raw、last_push_error、ahead/behind
- [x] 3.2 新增 `POST /api/v1/vcs/remote`、`POST /api/v1/vcs/push`、`POST /api/v1/vcs/backup`
- [x] 3.3 `VCSLog` 默认过滤 ingest/rollback；`GET /settings` 含新键
- [x] 3.4 注册路由与 handler 测试

## 4. Ingest 集成

- [x] 4.1 ingest/rollback commit 成功后：若 `vc_auto_push` 则 push（失败记 activity，不改 job 状态）
- [x] 4.2 backup commit 成功后同样可选 auto-push

## 5. 前端 Settings 与 i18n

- [x] 5.1 扩展 `VCStatus` 类型与 `lib/api.ts`（remote、push、backup API）
- [x] 5.2 Settings 版本控制区：remote URL、auto-push 开关、backup raw 开关（默认开）、立即备份、立即 Push
- [x] 5.3 中英文 i18n 与 `settings-page` 测试

## 6. Timeline 与文档

- [x] 6.1 确认 Timeline 使用过滤后的 log API；diff/rollback 行为回归测试
- [x] 6.2 更新 README 或 help：新环境 clone → init → 重填 API Key → reindex 流程
- [x] 6.3 `internal/vcs` 与 API 端到端测试（backup commit、push mock、settings  round-trip）
