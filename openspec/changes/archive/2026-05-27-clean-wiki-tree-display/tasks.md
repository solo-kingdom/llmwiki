# Tasks: clean-wiki-tree-display

## Task 1: 定义隐藏目录常量和判断函数

- [x] 新增 `WikiHiddenSubdirs` map，包含 `"templates"` 和 `"sources"`
- [x] 新增 `IsHiddenWikiSubdir(relPath string) bool` 函数，判断路径是否在隐藏目录下
- [x] 添加对应单元测试到 `wiki_org_test.go`

## Task 2: ListDocumentsFiltered 排除隐藏目录

- [x] `ListDocumentsFilter` 增加 `ExcludeHidden bool` 字段
- [x] 在 `ListDocumentsFiltered` 的 SQL 查询中，当 `ExcludeHidden=true` 时追加排除条件
- [x] 添加单元测试验证 templates/sources 文档被排除，其他类型文档正常返回

## Task 3: 搜索排除隐藏目录

- [x] 在 `searchFTS5`、`searchLIKE`、`searchMetadata` 三个函数中，当 `pathFilter="wiki"` 时追加排除隐藏目录条件
- [x] 统一使用 `hiddenSubdirsWhere("d.relative_path")` SQL 片段
- [x] 验证现有搜索测试全部通过

## Task 4: 知识图谱排除隐藏目录

- [x] `BuildKnowledgeGraph` 的节点查询追加排除隐藏目录条件
- [x] 边查询过滤 source 或 target 在隐藏目录下的边
- [x] 编译验证通过

## Task 5: 公共 API 启用排除

- [x] `ListPublicWikiDocuments` 设置 `filter.ExcludeHidden = true`
- [x] `SearchPublicWiki` 已使用 `filter="wiki"` → 搜索函数内部已自动排除（Task 3 覆盖）

## Task 6: 内部 API 支持 exclude_hidden 参数

- [x] `ListDocuments` 读取 `exclude_hidden` query param
- [x] 当 `exclude_hidden=true` 时设置 `filter.ExcludeHidden = true`
- [x] 默认 false，向后兼容

## Task 7: 前端去除 wiki/ 根节点

- [x] `buildTree()` 新增 `stripWikiPrefix()` 剥离 `doc.path` 中的 `wiki/` 前缀
- [x] 树从 `entities/`、`concepts/` 等直接开始，不再有 `wiki/` 外层
- [x] TypeScript 编译通过

## Task 8: 前端 Sidebar 请求传参

- [x] `api.listDocuments()` 新增 `exclude_hidden` 参数支持
- [x] `WikiReaderContext.tsx` 中 `listDocuments` 调用传递 `exclude_hidden: true`
- [x] 公共 API 路径 (`listPublicDocuments`) 已在后端启用排除（Task 5）
- [x] TypeScript 编译通过
