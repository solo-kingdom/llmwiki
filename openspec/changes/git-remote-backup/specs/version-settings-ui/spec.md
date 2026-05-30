## MODIFIED Requirements

### Requirement: 版本控制设置区域
Settings 页面 SHALL 提供版本控制区域，展示 git 仓库状态、备份与远程同步控制。

#### Scenario: 版本控制已就绪状态展示
- **WHEN** workspace 存在 `.git` 目录
- **THEN** Settings 页面 SHALL 显示 "Version Control" 区域，状态为 "Active"
- **AND** SHALL 展示提交总数、轨道 A 追踪目录 `wiki/`、备份说明（含 `raw/` 开关状态）
- **AND** SHALL 提供 [View History] 按钮（跳转 Timeline 页面）
- **AND** SHALL NOT 提供 Enable 或 Disable 按钮

#### Scenario: Legacy workspace 缺少 git
- **WHEN** workspace 无 `.git` 目录（旧 workspace 未 repair）
- **THEN** Settings 页面 SHALL 显示提示信息，建议用户运行 `llmwiki init <dir>` 补全版本控制
- **AND** SHALL NOT 提供 [Enable Version Control] 按钮

## ADDED Requirements

### Requirement: 备份 raw 开关
Settings 版本控制区域 SHALL 提供 `backup_include_raw` 开关，默认开启。

#### Scenario: 关闭 raw 备份
- **WHEN** 用户关闭「备份 raw 素材」并保存
- **THEN** SHALL 通过 Settings API 持久化 `backup_include_raw=false`
- **AND** 后续备份 commit SHALL 不包含 `raw/`

### Requirement: 远程仓库与 push 控制
Settings SHALL 提供远程 URL 配置、自动 push 开关（默认关）、手动 Push 按钮、最近 push 错误展示。

#### Scenario: 配置远程 URL
- **WHEN** 用户输入 remote URL 并保存
- **THEN** SHALL 调用 VCS remote API 配置 `origin`

#### Scenario: 手动 push
- **WHEN** 用户点击「立即 Push」
- **THEN** SHALL 调用 `POST /api/v1/vcs/push` 并展示结果

#### Scenario: 自动 push 默认关
- **WHEN** 用户未修改自动 push 设置
- **THEN** UI SHALL 显示自动 push 为关闭状态

### Requirement: 手动备份按钮
Settings SHALL 提供「立即备份」操作，触发 `POST /api/v1/vcs/backup`。

#### Scenario: 手动备份成功
- **WHEN** 用户点击立即备份且存在可备份变更
- **THEN** SHALL 显示成功提示及可选的最新 backup commit 信息

### Requirement: 版本控制状态 API 扩展
`GET /api/v1/vcs/status` 响应 SHALL 扩展 remote 与备份相关字段。

#### Scenario: 查询版本控制状态
- **WHEN** 客户端查询版本控制状态
- **THEN** 系统 SHALL 返回：是否启用（基于 `.git` 是否存在）、提交总数、git 是否可用、remote 配置状态、`vc_auto_push`、`backup_include_raw`、最近 push 错误（若有）
