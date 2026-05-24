# version-settings-ui Specification

## Purpose
Define the Settings page version control status display and related HTTP APIs.
## Requirements
### Requirement: 版本控制设置区域
Settings 页面 SHALL 提供版本控制只读状态区域，展示 git 仓库状态和基本信息。

#### Scenario: 版本控制已就绪状态展示
- **WHEN** workspace 存在 `.git` 目录
- **THEN** Settings 页面 SHALL 显示 "Version Control" 区域，状态为 "Active"
- **AND** SHALL 展示提交总数、追踪目录 `wiki/`、排除目录 `.llmwiki/`, `raw/`, `revert/`
- **AND** SHALL 提供 [View History] 按钮（跳转 Timeline 页面）
- **AND** SHALL NOT 提供 Enable 或 Disable 按钮

#### Scenario: Legacy workspace 缺少 git
- **WHEN** workspace 无 `.git` 目录（旧 workspace 未 repair）
- **THEN** Settings 页面 SHALL 显示提示信息，建议用户运行 `llmwiki init <dir>` 补全版本控制
- **AND** SHALL NOT 提供 [Enable Version Control] 按钮

### Requirement: 版本控制初始化 API
系统 SHALL 提供版本控制初始化的 HTTP API（幂等 repair 用途）。

#### Scenario: 初始化版本控制
- **WHEN** 客户端发送初始化请求
- **THEN** 系统 SHALL 在 workspace 执行 git init + .gitignore + initial commit（若尚未初始化）
- **AND** 返回初始化状态（commit SHA、commit 数）

#### Scenario: 重复初始化
- **WHEN** workspace 已有 .git 目录
- **THEN** 系统 SHALL 返回当前状态信息，不重复初始化

#### Scenario: 查询版本控制状态
- **WHEN** 客户端查询版本控制状态
- **THEN** 系统 SHALL 返回：是否启用（基于 `.git` 是否存在）、提交总数、是否 git 可用

