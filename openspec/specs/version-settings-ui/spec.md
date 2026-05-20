## ADDED Requirements

### Requirement: 版本控制设置区域
Settings 页面 SHALL 提供版本控制管理区域，支持初始化、状态查看和基本操作。

#### Scenario: 未初始化状态
- **WHEN** workspace 未启用版本控制（无 .git 目录）
- **THEN** Settings 页面 SHALL 显示 "Version Control" 区域，状态为 "Not Enabled"，提供 [Enable Version Control] 按钮

#### Scenario: 启用版本控制
- **WHEN** 用户点击 [Enable Version Control] 按钮
- **THEN** 系统 SHALL 在 workspace 执行 git init + .gitignore 配置 + initial commit
- **AND** 按钮变为 loading 状态，完成后刷新为 "Active" 状态

#### Scenario: 启用成功状态展示
- **WHEN** 版本控制已启用
- **THEN** Settings 页面 SHALL 显示：
  - 状态标记 "Active"
  - 提交总数
  - 追踪目录 `wiki/`
  - 排除目录 `.llmwiki/`, `raw/`, `revert/`
  - [View History] 按钮（跳转 Timeline 页面）
  - [Disable] 按钮

#### Scenario: 禁用版本控制
- **WHEN** 用户点击 [Disable] 按钮
- **THEN** 系统 SHALL 显示确认对话框，说明"禁用将保留 .git 目录但停止自动提交"
- **AND** 确认后系统 SHALL 停止自动 git commit，保留 .git 目录和历史

#### Scenario: Git 不可用提示
- **WHEN** 系统检测到 git CLI 不可用
- **THEN** [Enable Version Control] 按钮 SHALL 显示为 disabled，并提示 "Git is not installed. Please install git to enable version control."

### Requirement: 版本控制初始化 API
系统 SHALL 提供版本控制初始化的 HTTP API。

#### Scenario: 初始化版本控制
- **WHEN** 客户端发送初始化请求
- **THEN** 系统 SHALL 在 workspace 执行 git init + .gitignore + initial commit
- **AND** 返回初始化状态（commit SHA、文件数）

#### Scenario: 重复初始化
- **WHEN** workspace 已有 .git 目录
- **THEN** 系统 SHALL 返回当前状态信息，不重复初始化

#### Scenario: 查询版本控制状态
- **WHEN** 客户端查询版本控制状态
- **THEN** 系统 SHALL 返回：是否启用、提交总数、是否 git 可用

### Requirement: 禁用版本控制 API
系统 SHALL 提供禁用版本控制的 HTTP API。

#### Scenario: 禁用版本控制
- **WHEN** 客户端发送禁用请求
- **THEN** 系统 SHALL 设置配置标记，停止自动 git commit
- **AND** 保留 .git 目录和历史记录不变
