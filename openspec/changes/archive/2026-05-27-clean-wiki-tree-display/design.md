# Design: clean-wiki-tree-display

## Overview

在后端数据查询层统一排除 `templates/` 和 `sources/` 目录下的文档，前端去除 `wiki/` 根节点的冗余缩进。

## Architecture

### 隐藏目录定义

在 `engine/wiki_org.go` 中新增 `WikiHiddenSubdirs`，定义在展示层需要隐藏的 wiki 子目录集合：

```
WikiHiddenSubdirs = map[string]struct{}{
    "templates": {},   // 系统模板，已有 WikiSystemSubdirs 定义
    "sources":   {},   // 来源摘要，中间产物
}
```

不修改现有的 `WikiSystemSubdirs` 和 `TypedWikiSubdirs`，因为它们服务于不同的关注点（lint 分类 vs 页面类型 vs 展示可见性）。

### 过滤策略

采用 **DB 层过滤 + API 层启用** 的策略：

```
┌──────────────────────────────────────────────────────────┐
│                      过滤点                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. ListDocumentsFiltered()                              │
│     新增 ExcludeHidden bool 字段                         │
│     SQL: AND NOT (relative_path LIKE 'wiki/templates/%'  │
│                   OR relative_path LIKE 'wiki/sources/%')│
│                                                          │
│  2. SearchChunks() 系列函数                              │
│     当 pathFilter="wiki" 时，追加排除条件                 │
│     在 searchFTS5 / searchLIKE / searchMetadata 中       │
│     统一追加隐藏目录排除                                  │
│                                                          │
│  3. BuildKnowledgeGraph()                                │
│     追加排除 templates/ 和 sources/ 的节点和边            │
│                                                          │
│  4. rebuildReferences()                                  │
│     不改 — 模板文件的引用关系保留在内部数据中             │
│     只在展示时过滤                                        │
│                                                          │
│  5. 前端 buildTree()                                     │
│     剥离 doc.path 中的 "wiki/" 前缀                      │
│     wiki/ 不再作为树的根节点出现                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 调用方启用策略

| 调用方 | 行为 |
|--------|------|
| `ListPublicWikiDocuments` | `ExcludeHidden: true`（默认启用） |
| `SearchPublicWiki` | 已有 `filter="wiki"` → 搜索函数内部自动排除隐藏目录 |
| `ListDocuments` (内部 API) | 新增 query param `exclude_hidden=true`，前端 Sidebar 请求时带上 |
| `BuildKnowledgeGraph` | 始终排除隐藏目录（知识图谱是展示功能） |

### 前端变更

`buildTree()` 在构建树之前，将每个文档的 `doc.path` 中的 `wiki/` 前缀剥离：

```
Before: path = "wiki/entities" → 树根节点: wiki/ → entities/
After:  path = "entities"      → 树根节点: entities/
```

剥离逻辑在前端处理，后端 API 返回的 path 字段保持不变（向后兼容，且其他消费者可能需要完整路径）。

## Affected Files

### 后端

| 文件 | 变更 |
|------|------|
| `internal/engine/wiki_org.go` | 新增 `WikiHiddenSubdirs`、`IsHiddenWikiSubdir()` |
| `internal/store/sqlite/documents.go` | `ListDocumentsFilter` 增加 `ExcludeHidden` 字段，SQL 追加排除条件 |
| `internal/store/sqlite/chunks.go` | `searchFTS5`、`searchLIKE`、`searchMetadata` 在 `pathFilter="wiki"` 时排除隐藏目录 |
| `internal/store/sqlite/graph.go` | `BuildKnowledgeGraph` 排除 templates/sources 节点和边 |
| `internal/api/public_wiki.go` | `ListPublicWikiDocuments` 启用 `ExcludeHidden: true` |
| `internal/api/documents.go` | `ListDocuments` 支持 `exclude_hidden` query param |

### 前端

| 文件 | 变更 |
|------|------|
| `web/src/lib/tree.ts` | `buildTree()` 剥离 `wiki/` 前缀 |

## Risks

- **向后兼容**：内部 API 的 `exclude_hidden` 是 opt-in 参数，默认 false，不影响现有调用方
- **搜索一致性**：隐藏目录在所有搜索路径（FTS5、LIKE、metadata）中统一排除
- **图谱完整性**：隐藏节点可能导致某些边的一端丢失，需要在查询时同时过滤边
