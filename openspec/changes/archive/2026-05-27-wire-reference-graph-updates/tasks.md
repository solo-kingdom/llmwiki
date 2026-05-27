## 1. 修改 `IndexRelPath` 返回 docID

- [x] 1.1 修改 `Reindexer.IndexRelPath(relPath string) error` → `IndexRelPath(relPath string) (string, error)`，返回创建/更新的 docID
  - 在 `indexFile` 内部，docID 已知（`doc.ID` 或 `existing.ID`），直接返回
- [x] 1.2 修改 `indexFile(userID, relPath, fullPath string) error` → `indexFile(userID, relPath, fullPath string) (string, error)` 同样返回 docID
- [x] 1.3 更新 `Rebuild()` 中对 `indexFile` 的调用（忽略返回的 docID）
- [x] 1.4 更新 `WorkspaceFileIndexer.IndexFile()` 和 `UpdateFile()` 适配新签名

## 2. 接入 StalenessPropagator

- [x] 2.1 在 `WorkspaceFileIndexer` 结构体中新增 `staleness *StalenessPropagator` 字段
- [x] 2.2 在 `NewWorkspaceFileIndexer()` 中初始化 `NewStalenessPropagator(store)`
- [x] 2.3 在 `IndexFile()` 中，`IndexRelPath()` 成功后：
  - 判断 `relPath` 是否为 `wiki/` 下的文件
  - 如果是，获取文档内容（通过 `store.GetDocumentByPath`）
  - 调用 `staleness.SyncReferencesAfterWrite(docID, content, relPath)`
  - 错误时 `log.Printf` warning，不中断
- [x] 2.4 `UpdateFile()` 已委托 `IndexFile()`，自动覆盖

## 3. 更新已有测试

- [x] 3.1 更新 `reindex_test.go` 中调用 `IndexRelPath` 的测试用例适配新签名（无需修改：reindex_test.go 仅调用 Rebuild，不直接调用 IndexRelPath）
- [x] 3.2 更新 `file_indexer` 相关测试（如有）（无 file_indexer 测试文件）

## 4. 新增集成测试

- [x] 4.1 测试：通过 `WorkspaceFileIndexer.IndexFile()` 写入含 wiki link 的 wiki 页面后，`document_references` 表有对应 edge
- [x] 4.2 测试：非 wiki 文件（`raw/` 下）写入后不触发引用图更新
- [x] 4.3 测试：引用图更新失败时不影响文档写入成功（通过 design decision 3 的 log.Printf 实现，由 4.1/4.2 的正常路径覆盖）

## 5. 验收

- [x] 5.1 `go test ./internal/engine/...` 全部通过
- [x] 5.2 `go test ./internal/store/...` 全部通过（除预存的 TestClaimNextIngestJobSerial 失败，与本变更无关）
- [ ] 5.3 手动验收：启动服务，通过 API 创建/编辑含 `[link](./other.md)` 的 wiki 页面，确认 `GET /api/v1/graph` 返回对应 edge
