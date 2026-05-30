## Why

知识图谱始终为空。根因是 `ReferenceParser.parseWikiLinks()` 只识别 `[text](href)` 格式的 markdown 链接，但项目约定的链接语法是 `[[wikilink]]`（Obsidian 风格双括号）。Lint 工具已正确解析 `[[wikilink]]`（`wikiDoubleBracketRe`），引用图谱解析器却缺少这一分支，导致 `document_references` 表中没有 `links_to` 边，`BuildKnowledgeGraph()` 返回空图谱。

## What Changes

- 在 `internal/engine/references.go` 的 `ReferenceParser` 中增加 `[[wikilink]]` 语法的解析，产出 `links_to` 边
- 支持三种变体：`[[target]]`、`[[path/to/page]]`、`[[path|display text]]`
- 复用已有的 `resolveWikiPath` 解析策略（精确匹配 → 追加 .md → basename 匹配）
- 补充单元测试覆盖各种 `[[wikilink]]` 场景
- 用户需重新 `llmwiki reindex` 以重建引用图

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `reference-graph`: 扩展 "Wiki link parsing" 需求，增加 `[[wikilink]]` 双括号语法的解析与 `links_to` 边生成

## Impact

- **代码**: `internal/engine/references.go`（`parseWikiLinks` 增加 `[[...]]` 分支）、`internal/engine/references_test.go`（新增测试用例）
- **数据**: 修复后用户需重新运行 `llmwiki reindex` 重建 `document_references` 表
- **无 API 变更**: 知识图谱 API 接口不变，只是返回的数据从空变为有内容
- **无前端变更**: `GraphPage.tsx` 的 `isGraphEmpty` 判断逻辑无需修改
