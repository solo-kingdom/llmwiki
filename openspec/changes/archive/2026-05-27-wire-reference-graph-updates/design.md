## Context

现有代码：

```
已实现但未接入                     已接入但无引用更新
─────────────────                 ──────────────────
StalenessPropagator               WorkspaceFileIndexer
  ├── SyncReferencesAfterWrite()    ├── IndexFile() → reindexer.IndexRelPath()
  │   ├── ListAllDocuments()        │   └── indexFile() → doc + chunks only
  │   ├── ParseReferences()         └── UpdateFile() → IndexFile()
  │   └── ReplaceReferencesInTx()
  └── PropagateAfterWrite()
      └── PropagateStaleness()

已有测试覆盖：
- staleness_test.go: TestSyncReferencesAfterWrite, TestPropagateAfterWrite
- references_test.go: 解析逻辑测试
- references_test.go (store): ReplaceReferencesInTx 测试
```

## Goals / Non-Goals

**Goals:**

- 每次 wiki 页面创建/更新后，`document_references` 表自动同步
- 写入失败不阻塞主流程（log warning，继续）
- 只对 `wiki/` 下的文件执行引用图更新（非 wiki 文件跳过）
- 复用已有的 `StalenessPropagator`，不重复实现

**Non-Goals:**

- 启动时自动 reindex（独立 change）
- 实时推送图谱变更到前端（首版用刷新即可）
- 优化 `ListAllDocuments()` 性能（当前规模可接受）

## Decisions

### Decision 1: 接入点 — `WorkspaceFileIndexer`

在 `WorkspaceFileIndexer` 中持有 `StalenessPropagator`，而非在每个调用点（API、MCP、Watcher）分别接入。

理由：
- 单一接入点，减少遗漏风险
- `WorkspaceFileIndexer` 是所有写路径的汇聚点
- 调用方（API、Watcher、MCP）无需知道引用图的存在

```
API CreateDocument ──┐
API UpdateContent ──┤
Watcher IndexFile ──┼──▶ WorkspaceFileIndexer.IndexFile()
MCP write_wiki ─────┘         │
                              ├── reindexer.IndexRelPath()  (doc + chunks)
                              │
                              └── NEW: stalenessPropagator.SyncReferencesAfterWrite()
                                       (only for wiki/ files)
```

### Decision 2: 仅对 wiki 文件触发引用更新

`IndexFile()` 已有 `isIndexableRelPath()` 判断 `wiki/` 或 `raw/`。只有 `wiki/` 下的 `.md` 文件才需要解析引用。raw/sources 文件不存在 wiki link 语法。

### Decision 3: 错误处理 — 日志不阻塞

引用图更新失败时，记录 warning 日志但不返回错误。理由：
- 引用图是派生数据，可从全量 reindex 重建
- 主写入（文档 + 搜索块）的成功更重要
- 避免用户保存 wiki 页面时因引用解析失败而看到 500 错误

### Decision 4: 需要 docID 和 content

`SyncReferencesAfterWrite(docID, content, docPath)` 需要：
- `docID`: `IndexRelPath()` 执行后可通过 `GetDocumentByPath()` 获取
- `content`: 已在 `indexFile()` 中读取
- `docPath`: 已知（relPath 参数）

方案：让 `IndexRelPath()` 返回 docID，或者让 `WorkspaceFileIndexer` 在调用 `IndexRelPath()` 后查询 docID。

选择后者（查询 docID），因为修改 `IndexRelPath` 签名影响面更大：
1. `IndexRelPath(relPath)` 执行
2. 通过 `store.GetDocumentByPath(filename, dir)` 获取 docID
3. 仅对 wiki 文件调用 `SyncReferencesAfterWrite(docID, content, docPath)`

但需要 content。当前 `IndexRelPath` 内部读取文件但不返回 content。

**优化方案**: 修改 `IndexRelPath` 使其返回 `(docID, error)`，这样调用方可以直接拿到 docID 获取文档内容。这是最小改动路径。

### Decision 5: StalenessPropagator 构造

`WorkspaceFileIndexer` 已持有 `Store`，直接用它创建 `StalenessPropagator`：

```go
func NewWorkspaceFileIndexer(store Store, workspace string) *WorkspaceFileIndexer {
    return &WorkspaceFileIndexer{
        reindexer:  NewReindexer(store, workspace),
        store:      store,
        staleness:  NewStalenessPropagator(store),  // NEW
    }
}
```

## Risks

| 风险 | 缓解 |
|------|------|
| `ListAllDocuments()` 每次写入调用，大规模 workspace 可能慢 | 当前个人 wiki 规模（<1000 页）可接受；后续可缓存 |
| 引用图更新失败导致不一致 | log warning + 全量 reindex 兜底 |
| Watcher 高频写入触发大量引用更新 | Watcher 已有 700ms debounce，实际不会过于频繁 |
