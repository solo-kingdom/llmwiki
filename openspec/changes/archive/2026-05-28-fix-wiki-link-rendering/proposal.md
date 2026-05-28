## Why

Wiki 文档中广泛使用 `[[link]]` 双括号语法来引用其他页面。后端已经正确解析这些链接用于知识图谱和 lint 检查，但前端渲染时 `[[link]]` 原样显示为纯文本，无法点击跳转。这严重影响了 wiki 的浏览体验——用户看到链接却无法点击。

## What Changes

- 新增一个自定义 remark 插件，将 `[[target]]` 和 `[[target|显示文本]]` 语法转换为可点击的 HTML 链接
- 利用前端已加载的文档列表（`WikiReaderContext.documents`），在前端解析 wiki 路径到文档 ID
- 在 `DocumentViewer` 中集成插件，使转换后的链接与现有的点击导航逻辑无缝配合
- 在 `MarkdownContent` 组件中同样支持 wikilink 渲染（用于 HelpPage、SourcePreview 等场景）
- 对无法解析的链接提供视觉区分（显示为带样式的断链）

## Capabilities

### New Capabilities
- `wiki-link-rendering`: 前端 remark 插件，将 `[[wikilink]]` 语法转换为可点击导航链接，支持路径解析和断链标记

### Modified Capabilities
- `wiki-reader-ui`: DocumentViewer 和 MarkdownContent 组件集成 wikilink 渲染插件

## Impact

- **前端代码**: `web/src/components/DocumentViewer.tsx`、`web/src/components/MarkdownContent.tsx`、新增 `web/src/lib/remark-wikilink.ts`
- **依赖**: 无需新增 npm 依赖（基于已有 `react-markdown` 的 remark 插件接口）
- **后端**: 无变更（后端已正确解析 wikilink）
- **测试**: 需要新增 remark 插件单元测试和组件集成测试
