## ADDED Requirements

### Requirement: Workspace 初始化预留 revert 目录
系统在 workspace 初始化时 SHALL 创建 `revert/` 目录结构。

#### Scenario: 初始化创建 revert 目录
- **WHEN** 用户执行 `llmwiki init <dir>` 初始化 workspace
- **THEN** 系统 SHALL 创建 `revert/` 目录（与 `wiki/`、`raw/sources/` 并列）

### Requirement: Reindex 兼容 git checkout 后的文件变化
系统 reindex 流程 SHALL 正确处理因 git checkout 导致的 wiki 文件批量变化。

#### Scenario: Git checkout 恢复文件后 reindex
- **WHEN** wiki/ 目录中的文件因 git checkout 发生批量变化（新增、修改、删除）
- **THEN** file watcher SHALL 检测到变化并触发 reindex
- **AND** reindex SHALL 正确处理文件删除（从 index 中移除对应记录）

#### Scenario: Revert 目录不参与 reindex
- **WHEN** reindex 扫描 workspace 目录
- **THEN** 系统 SHALL 忽略 `revert/` 目录中的文件
