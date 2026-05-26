## Why

Ingest Chat、Review 页与 Jobs 源文件预览中的 assistant / Markdown 内容缺少有效样式：Chat 完成态使用了未启用的 Tailwind `prose` 类，流式阶段则仅以纯文本展示，导致长回复中标题、列表、代码块等结构不可读。Wiki 阅读器已有可用的 `.wiki-prose` 样式体系，但其他 Markdown 渲染点未复用，造成体验不一致且违背 `ingest-chat-ui` 对 Markdown 渲染的要求。

## What Changes

- 新增共享 `MarkdownContent` 组件，统一 `remarkGfm` + `rehypeHighlight` 渲染与样式变体
- 新增 `.chat-prose` 紧凑排版变体，供 Chat 气泡使用；Review / SourcePreview 复用标准 `.wiki-prose`
- Ingest Chat 流式与完成态 assistant 消息均改为 Markdown 渲染（不再使用 `whitespace-pre-wrap` 纯文本）
- Review 页 plan 预览与 SourcePreviewDialog 文本预览改用共享组件与有效样式
- 为宽表格等内容补充横向滚动等溢出处理
- 移除对未启用 `@tailwindcss/typography` 的 `prose` 类依赖（不新增该插件）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ingest-chat-ui`：明确 assistant 流式与完成态均 SHALL 以 Markdown 结构化渲染
- `web-ui`：Review plan Markdown 预览 SHALL 使用 wiki-prose 样式体系
- `job-source-preview`：Jobs 源文件 Markdown 预览 SHALL 使用 wiki-prose 样式与代码高亮

## Impact

- **前端**：`web/src/components/IngestChat.tsx`、`ReviewPage.tsx`、`SourcePreviewDialog.tsx`；新增 `MarkdownContent` 组件；`web/src/App.css` 增加 `.chat-prose`
- **测试**：`web/src/ingest-chat.test.tsx` 及必要的组件测试
- **无后端 / API 变更**；不修改 `DocumentViewer`（已正常工作，后续可选迁移至共享组件）
