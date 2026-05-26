## 1. Backend — 列表与类型

- [x] 1.1 抽取或复用 `wikiPageType(relative_path)` 为共享包级函数（`internal/engine` 或 `internal/store/sqlite`）
- [x] 1.2 扩展 `ListDocuments`：`source_kind`、`type` 查询参数；响应增加 `relative_path`、`source_kind`、`page_type`
- [x] 1.3 公开 Wiki `listPublicDocuments` 同步 wiki-only 过滤与字段
- [x] 1.4 为 list 过滤添加 `documents` API 测试

## 2. Backend — 搜索

- [x] 2.1 扩展 `SearchChunks` / `GET /api/v1/search` 支持 `types`（多值 OR）且默认 wiki 范围
- [x] 2.2 公开 Wiki 搜索端点支持相同 `types` 语义
- [x] 2.3 添加 search types + wiki scope 单元测试

## 3. Frontend — Wiki 数据层

- [x] 3.1 更新 `DocumentListItem` 类型与 `listDocuments`/`searchDocuments` API 客户端（`source_kind=wiki` 默认、`types` 参数）
- [x] 3.2 `WikiReaderContext` 仅加载 wiki 文档；暴露 `page_type` 供侧栏使用
- [x] 3.3 添加 i18n：`wiki.type.*`（含「来源摘要」）、侧栏与搜索 chips 文案

## 4. Frontend — 侧栏

- [x] 4.1 实现类型筛选 chips，联动过滤目录树
- [x] 4.2 实现实体列表区块（`page_type=entity`，按 title 排序，受筛选联动）
- [x] 4.3 确认侧栏树不含 raw；更新 `Sidebar` / `buildTree` 测试

## 5. Frontend — 搜索模态

- [x] 5.1 `SearchModal` 增加类型 chips，请求带 `types`（与 `q` AND）
- [x] 5.2 更新 `wiki-reader.test.tsx` 覆盖类型筛选搜索

## 6. Frontend — 图谱迁入 Wiki

- [x] 6.1 `wiki-routes` 增加 `/wiki/graph`；`WikiReaderLayout` 按路径渲染 `GraphPage`
- [x] 6.2 Wiki 顶栏增加图谱入口；`WorkbenchLayout` 移除 graph 导航项
- [x] 6.3 `/graph` 重定向到 `/wiki/graph`；更新 `graph-page.test.tsx` 与 `app-nav.test.tsx`

## 7. 收尾

- [x] 7.1 跑 `go test ./...` 与 `npm test`（web）确保通过
- [x] 7.2 手动验证：侧栏无 raw、实体列表、类型搜索、图谱从 Wiki 打开且节点跳转正常
