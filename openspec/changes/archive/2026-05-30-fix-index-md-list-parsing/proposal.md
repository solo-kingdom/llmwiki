## Why

`wiki/index.md` 由 reindex 自动生成，表格「页面」列使用 `[[subdir/slug|标题]]` 格式的 wikilink。GFM 表格以 `|` 作为列分隔符，未转义的 wikilink 内 `|` 会被误解析为额外列，导致 Web UI 中实体/概念/源摘要列表出现裸露的 `[[...]]`、标题重复，以及摘要、更新日期列丢失或错位。

## What Changes

- 修复 `IndexBuilder` 生成 index 表格时对 wikilink 内 `|` 的转义（使用 GFM 的 `\|` 语法），确保每行严格四列
- 确保前端 wikilink remark 插件能正确识别转义后的 `[[target\|display]]` 并渲染为可点击链接
- 补充后端与前端测试，覆盖含 `|` 的 wikilink 表格行
- 用户运行 `llmwiki reindex` 后现有 workspace 的 `wiki/index.md` 将自动修复

## Capabilities

### New Capabilities

（无新增 capability）

### Modified Capabilities

- `workspace-management`: index 生成时 wikilink 在 GFM 表格单元格内必须正确转义，保证四列结构稳定
- `web-ui`: Wiki Reader 渲染 `wiki/index.md` 时表格应显示可点击链接、标题、摘要、更新日期四列，无重复标题或裸露 wikilink 语法

## Impact

- **后端**: `internal/engine/index_builder.go`、`index_builder_test.go`
- **前端**: `web/src/lib/remark-wikilink.ts`、`remark-wikilink.test.ts`；可能涉及 `MarkdownContent` 相关测试
- **数据**: 无 schema 变更；需 reindex 重建现有 `wiki/index.md`
- **兼容性**: 非破坏性；旧 index 在 reindex 前仍可能显示异常，reindex 后自动修复
