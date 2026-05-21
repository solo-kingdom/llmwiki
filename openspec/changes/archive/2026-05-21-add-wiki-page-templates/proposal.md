## Why

多源 ingest 产出的 wiki 页面结构不一致，影响 lint、搜索和人工阅读。LLM-Wiki-Skilled 和 OmegaWiki 均通过页面模板定义每种类型的必需章节。嵌入 Generation prompt 可低成本统一输出格式。

## What Changes

- 在 workspace 创建 `wiki/templates/`（init scaffold）
- 模板文件：`entity.md`, `concept.md`, `source.md`, `synthesis.md`, `comparison.md`, `query.md`
- 中文 section 标题与 Required Sections 说明
- pipeline `generate()` system prompt 注入模板摘要
- 可选：lint Required Sections 验证（最小版）

## Scope

### In Scope

- 6 类 wiki 页面中文模板
- init scaffold 写入 templates
- generation prompt 改造
- 模板常量 + 测试

### Out of Scope

- 运行时模板编辑器 UI
- 完整 Required Sections lint（可留给 add-wiki-lint 后续任务）

## Capabilities

### New Capabilities

- `wiki-page-templates`: 页面类型模板与 ingest prompt 集成

### Modified Capabilities

- `workspace-management`: init 创建 wiki/templates/
- `ingest-pipeline`: generation prompt 引用模板

## Dependencies

- `fix-workspace-scaffold-zh`（目录结构）
- 建议在 `add-page-merge-protection` 之后（稳定写入后再统一格式）
