## 1. 样式基础

- [x] 1.1 在 `App.css` 新增 `.chat-prose` 紧凑排版（标题字号、段落间距），并与 `.wiki-prose` 共享 code/pre/table/blockquote 规则
- [x] 1.2 为 Markdown 表格补充 `overflow-x-auto` 包裹样式（`.wiki-prose` 与 `.chat-prose` 均适用）

## 2. 共享组件

- [x] 2.1 新建 `web/src/components/MarkdownContent.tsx`：`variant="chat" | "reader"`、`remarkGfm`、`rehypeHighlight`、`highlight.js` 样式
- [x] 2.2 在 `MarkdownContent` 中为 `table` 提供自定义 component，外包横向滚动容器
- [x] 2.3 添加 `MarkdownContent` 单元测试（至少验证 chat/reader variant 渲染标题与代码块）

## 3. Chat 集成

- [x] 3.1 更新 `IngestChat.tsx`：assistant 完成态改用 `<MarkdownContent variant="chat" />`，移除失效的 `prose` 类与 inline `ReactMarkdown`
- [x] 3.2 更新 `IngestChat.tsx`：assistant 流式阶段同样使用 `<MarkdownContent variant="chat" />`（替换 `whitespace-pre-wrap` 纯文本）
- [x] 3.3 更新 `ingest-chat.test.tsx`：补充/调整 assistant markdown 渲染相关断言

## 4. 其他预览页集成

- [x] 4.1 更新 `ReviewPage.tsx`：plan 预览改用 `<MarkdownContent variant="reader" />`
- [x] 4.2 更新 `SourcePreviewDialog.tsx`：文本预览改用 `<MarkdownContent variant="reader" />`

## 5. 验证

- [x] 5.1 运行 `web` 测试套件（`npm test`）确保通过
- [x] 5.2 手动验证：Chat 流式/完成态长 Markdown、Review plan、Jobs `.md` 源文件预览的标题/列表/代码块/表格可读性
