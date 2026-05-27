## Why

知识图谱始终为空。根因是 `document_references` 表从未被填充——全量 reindex 路径（`rebuildReferences()`）是唯一能写入引用边的代码路径，但服务器启动时不会自动 reindex，且单文件增量更新路径（API 写入、Watcher 文件变更、MCP 工具写入）均不触发引用图更新。

已有完整的 `StalenessPropagator` + `SyncReferencesAfterWrite()` 实现（含事务性 `ReplaceReferencesInTx` 和完整测试覆盖），但从未被任何生产代码路径实例化或调用。

## What Changes

- 在 `WorkspaceFileIndexer` 中接入 `StalenessPropagator`，使每次 wiki 页面写入后自动同步引用图
- 接入所有写路径：API `CreateDocument` / `UpdateDocumentContent`、Watcher `IndexFile` / `UpdateFile`、MCP 工具写入
- 删除 wiki 页面时，`ON DELETE CASCADE` 已确保引用自动清理，无需额外处理
- 确保全量 reindex 仍作为兜底方案可用

## Scope

### In Scope

- 将 `SyncReferencesAfterWrite` 接入 `WorkspaceFileIndexer.IndexFile()` / `UpdateFile()`
- 将 `PropagateAfterWrite` 接入写入后路径
- 对非 wiki 文件跳过引用图更新（性能保护）
- 错误处理：引用图更新失败不应阻塞主写入流程

### Out of Scope

- 图谱 UI 变更（已完成）
- 新引用类型
- 服务端启动时自动 reindex（独立 change）
- Watcher `RemoveFile` 引用清理（`ON DELETE CASCADE` 已覆盖）

## Capabilities

### Modified Capabilities

- `reference-graph`: 增量更新接入生产路径

## Dependencies

- 无外部依赖，所有基础设施已存在
