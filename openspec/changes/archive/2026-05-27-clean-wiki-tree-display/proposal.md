# clean-wiki-tree-display

## Problem

Wiki 目录树展示存在三个问题：

1. **`wiki/` 根节点冗余**：用户已经在 Wiki 视图中，目录树仍然显示 `wiki/` 作为最外层文件夹，浪费一级缩进且没有信息量。
2. **`templates/` 泄漏到用户界面**：系统模板文件（`wiki/templates/*.md`）出现在公共 API、内部文档列表 API、搜索结果、知识图谱和前端 Sidebar 目录树中。模板是给 LLM ingest session 参考的结构文件，不是用户知识内容。
3. **`sources/` 泄漏到用户界面**：来源摘要页面（`wiki/sources/*.md`）是原始素材的摘要，不应作为独立知识页面展示给最终用户。它们是中间产物，被其他页面引用但本身不需要在浏览树中可见。

## Proposal

在文档列表展示链路中全面隐藏 `templates/` 和 `sources/` 目录下的文档，并去除前端目录树中 `wiki/` 根节点的冗余显示。

具体范围：

| 目录 | 公共 API | 内部列表 API | 搜索 | 知识图谱 | 前端树 |
|------|----------|-------------|------|---------|--------|
| `templates/` | 隐藏 | 隐藏 | 隐藏 | 隐藏 | 隐藏 |
| `sources/` | 隐藏 | 隐藏 | 隐藏 | 隐藏 | 隐藏 |
| 其余 TypedWikiSubdirs | 正常展示 | 正常展示 | 正常展示 | 正常展示 | 正常展示 |

模板文件和来源摘要仍保留在 documents 表中，MCP diagnostic tools、LLM ingest pipeline、reindex/lint 等内部功能不受影响，只是不向浏览界面暴露。

## Scope

- **后端**：`ListDocumentsFiltered` 增加排除隐藏目录的过滤能力，公共 API 和内部 API 启用过滤；搜索和图谱查询同步排除
- **前端**：`buildTree()` 剥离 `wiki/` 前缀，消除根节点冗余
- **不影响**：reindex、lint、MCP tools、ingest pipeline、文件系统存储

## Out of Scope

- 不改变 `templates/` 和 `sources/` 在文件系统上的存储方式
- 不改变 `WikiSystemSubdirs` 或 `TypedWikiSubdirs` 的分类定义
- 不改变 ingest pipeline 对模板的读取和使用
- 不涉及 `WikiTypeFilter` 组件的类型列表变更（`template` 和 `source` 页面类型本身就不在 `WIKI_PAGE_TYPES` 中）
