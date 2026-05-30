## Why

LLM 生成的 `[[wikilink]]` 使用 title 风格的空格分隔（如 `[[Adam Foroughi]]`），但文件系统中的 wiki 页面路径使用连字符 slug 风格（如 `entities/adam-foroughi.md`）。前后端的 wikilink 解析器都没有做空格↔连字符归一化，导致大量 wikilink 被误判为断链（`wikilink-broken`）。同时，知识图谱页面点击节点后只修改了 URL，没有触发文档加载逻辑，导致页面空白。

## What Changes

- 前端 `remark-wikilink.ts` 的 `resolveWikiPath` 增加空格↔连字符归一化策略，并增加 title 索引兜底查找
- 后端 `references.go` 的 `resolveWikiPath` 增加空格↔连字符归一化策略，并在 wikilink 解析路径中补充 `docsByFilename` / `docsByBase` 索引查找
- `GraphPage` 组件的节点点击处理改为直接调用 `selectDocument()` 而非仅修改 URL
- 前后端保持解析策略一致（归一化在 basename 匹配之前、title 索引作为最终兜底）

## Capabilities

### New Capabilities

_(无新能力)_

### Modified Capabilities

- `wiki-link-rendering`: wikilink 解析策略增加空格↔连字符归一化和 title 索引查找
- `reference-graph`: 后端 wikilink 解析路径增加归一化和额外索引查找
- `knowledge-graph-ui`: 图谱节点点击行为从 URL-only 改为 context-driven 文档加载

## Impact

- 前端: `web/src/lib/remark-wikilink.ts`, `web/src/components/GraphPage.tsx`
- 后端: `internal/engine/references.go`
- 测试: `web/src/lib/remark-wikilink.test.ts`, `internal/engine/references_test.go`, `web/src/graph-page.test.tsx`
- 无 API 变更，无数据库变更，无 breaking change
