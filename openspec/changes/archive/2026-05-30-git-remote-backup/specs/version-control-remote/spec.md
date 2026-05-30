## ADDED Requirements

### Requirement: 远程仓库配置
系统 SHALL 支持为 workspace git 仓库配置 `origin` 远程 URL。

#### Scenario: 设置远程 URL
- **WHEN** 客户端提交有效的 remote URL（`POST /api/v1/vcs/remote` 或等效）
- **THEN** SHALL 执行 `git remote add origin` 或 `git remote set-url origin`
- **AND** 返回当前 remote 配置状态

#### Scenario: 查询远程状态
- **WHEN** 客户端查询 `GET /api/v1/vcs/status`
- **THEN** SHALL 返回：是否已配置 remote、remote URL（若存在）、当前分支、与 upstream 的 ahead/behind（若可计算）

### Requirement: Git push
系统 SHALL 支持将本地分支推送到已配置的 remote。

#### Scenario: 手动 push
- **WHEN** 客户端调用 `POST /api/v1/vcs/push`
- **THEN** SHALL 执行 `git push` 到 `origin` 当前分支
- **AND** 返回成功或错误详情

#### Scenario: 未配置 remote
- **WHEN** 无 `origin` 且客户端请求 push
- **THEN** SHALL 返回 400 级错误，提示先配置远程仓库

#### Scenario: push 认证失败
- **WHEN** git push 因认证失败退出
- **THEN** SHALL 返回明确错误，提示配置 SSH 或 git credential helper
- **AND** SHALL NOT 修改 ingest job 状态

### Requirement: 自动 push 开关
系统 SHALL 支持 `vc_auto_push` 配置项（存 `app_config`，默认 false）。

#### Scenario: 自动 push 开启
- **WHEN** `vc_auto_push` 为 true 且轨道 A 或轨道 B 产生新 commit 且已配置 `origin`
- **THEN** SHALL 在 commit 成功后尝试 `git push`

#### Scenario: 自动 push 默认关闭
- **WHEN** `vc_auto_push` 未配置
- **THEN** SHALL 视为 false，不自动 push

#### Scenario: push 失败不阻塞 commit
- **WHEN** 自动 push 失败
- **THEN** 本地 commit SHALL 保留
- **AND** SHALL 记录 `last_push_error` 供 status API 与 Settings 展示

### Requirement: 不做自动 pull
MVP 阶段系统 SHALL NOT 自动执行 `git pull` 或 merge。

#### Scenario: non-fast-forward
- **WHEN** push 因 remote 领先导致 non-fast-forward
- **THEN** SHALL 返回错误并提示用户通过 git CLI 处理
