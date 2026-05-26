## Context

当前前端有四处 Markdown 渲染点，样式策略不一致：

| 组件 | 渲染方式 | 样式 | 状态 |
|------|----------|------|------|
| `DocumentViewer` | `ReactMarkdown` + `rehypeHighlight` | `.wiki-prose`（`App.css` 自定义） | ✅ 正常 |
| `IngestChat` 完成态 | `ReactMarkdown` + `remarkGfm` | Tailwind `prose` | ❌ 插件未启用 |
| `IngestChat` 流式 | 纯文本 `whitespace-pre-wrap` | 无 | ❌ 无结构 |
| `ReviewPage` / `SourcePreviewDialog` | `ReactMarkdown` + `remarkGfm` | Tailwind `prose` | ❌ 插件未启用 |

`@tailwindcss/typography` 已在 `package.json` 中，但 `App.css` 未 `@plugin` 引入，`prose` 类不生成任何 CSS。

Wiki 阅读器的 `.wiki-prose` 已覆盖标题、段落、链接、代码块、表格、引用等样式，且与 `rehypeHighlight` + `highlight.js` 配合良好。

## Goals / Non-Goals

**Goals:**

- Chat assistant 消息在流式与完成态均呈现结构化 Markdown（标题、列表、代码块、表格等）
- Chat 气泡内使用紧凑排版（`.chat-prose`），非气泡场景使用标准 `.wiki-prose`
- Review plan 预览与 Jobs 源文件 Markdown 预览使用与 Wiki 一致的样式体系
- 抽取共享 `MarkdownContent` 组件，统一插件配置（`remarkGfm`、`rehypeHighlight`）
- 宽表格等内容支持横向滚动，避免撑破布局

**Non-Goals:**

- 不启用 `@tailwindcss/typography` 插件（避免引入第二套 prose 体系）
- 不重构 `DocumentViewer`（已正常；后续可选迁移至共享组件）
- 不处理 wikilink 点击导航（Chat / Review / Preview 场景无此需求）
- 不优化流式 partial markdown 的边界情况（如未闭合代码块闪烁）—— MVP 接受

## Decisions

### 1. 复用 `.wiki-prose` 而非启用 Typography 插件

**选择**：扩展 `App.css` 中的自定义 prose 样式，新增 `.chat-prose` 变体。

**理由**：Wiki 阅读器已验证可用；单一 CSS 来源，暗色模式与 design token 一致。

**备选**：`@plugin "@tailwindcss/typography"` — 会引入与 `.wiki-prose` 并存的第二套样式，Chat 与 Wiki 视觉可能不一致。

### 2. `.chat-prose` 作为 `.wiki-prose` 的紧凑覆盖

**选择**：`.chat-prose` 独立定义，复用 code/pre/table/blockquote 规则（通过组合选择器或 duplicate），覆盖标题字号与段落间距：

```
h1: 1.125rem (18px)   vs wiki 1.875rem
h2: 1rem   (16px)     vs wiki 1.5rem
h3: 0.9375rem (15px)  vs wiki 1.25rem
p margin: 0.5em        vs wiki 0.75em
```

**理由**：Chat 气泡 `max-w-[92%]` + `text-sm` 上下文，标准 wiki 标题过大。

### 3. 共享 `MarkdownContent` 组件

**选择**：新建 `web/src/components/MarkdownContent.tsx`：

```tsx
interface MarkdownContentProps {
  content: string
  variant?: "chat" | "reader"  // chat → chat-prose, reader → wiki-prose
  className?: string
  components?: Components     // 预留扩展，DocumentViewer 未来可用
}
```

内部统一：`remarkPlugins={[remarkGfm]}`、`rehypePlugins={[rehypeHighlight]}`，import `highlight.js/styles/github.css`。

**理由**：三处失效点 + Chat 流式/完成双路径，一处维护避免再次遗漏。

### 4. Chat 流式阶段同样使用 Markdown 渲染

**选择**：流式与完成态共用 `<MarkdownContent variant="chat" content={msg.content} />`。

**理由**：用户反馈「流式与完成都有问题」；长回复在输出过程中即应可读。

**备选**：流式 plain text、完成后切换 Markdown — 体验割裂，拒绝。

### 5. 表格溢出处理

**选择**：在 `MarkdownContent` 中为 `table` 提供自定义 component，外包 `<div className="overflow-x-auto">` 包裹 `<table>`。

**理由**：GFM 表格在窄气泡中常见溢出；CSS `overflow-x` 单独加在 `table` 上无效。

## Risks / Trade-offs

- **[Risk] 流式 partial markdown 排版闪烁**（未闭合 ` ``` `）→ MVP 接受；多数 Chat 产品同样处理；后续可加 debounce 或 code-block 延迟 highlight
- **[Risk] 流式高频 re-render 性能** → `ReactMarkdown` 对典型回复长度可接受；若有问题可 memo content
- **[Risk] `.chat-prose` 与 `.wiki-prose` 规则重复** → 共享 code/pre/table 选择器（`.wiki-prose, .chat-prose pre { ... }`）减少 drift
- **[Risk] highlight.js CSS 重复 import** → `DocumentViewer` 与 `MarkdownContent` 各 import 一次，Vite 会去重；可选后续 Consolidate

## Migration Plan

纯前端变更，无数据迁移：

1. 新增 `MarkdownContent` + `.chat-prose` CSS
2. 替换 `IngestChat`、`ReviewPage`、`SourcePreviewDialog` 中的 inline `ReactMarkdown`
3. 运行 `web` 测试与手动验证 Chat 流式/完成、Review plan、Jobs 预览
4. 回滚：revert 前端 commit 即可

## Open Questions

（无 — 探索阶段已确认范围与方向）
