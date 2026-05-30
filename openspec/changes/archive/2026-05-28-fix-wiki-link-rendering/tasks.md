## 1. 核心插件实现

- [x] 1.1 创建 `web/src/lib/remark-wikilink.ts`：实现 `createRemarkWikiLink(documents)` 工厂函数，接受文档列表参数，内部构建 `docsByWikiPath` 映射表（与后端 `references.go` 的 `NewReferenceParser` 逻辑一致）
- [x] 1.2 实现 remark 插件的 `transform(tree)` 逻辑：遍历 markdown AST，找到包含 `[[...]]` 模式的 text 节点，用正则匹配拆分并替换为 link 节点或带 `wikilink-broken` 类的 html 节点
- [x] 1.3 实现 `resolveWikiPath()` 前端版本：三步策略（精确匹配 → 追加 `.md` → 基名匹配），大小写不敏感

## 2. 组件集成

- [x] 2.1 修改 `web/src/components/DocumentViewer.tsx`：从 `useWikiReader()` 获取 `documents`，使用 `useMemo` 创建 `createRemarkWikiLink(documents)` 插件实例，将其加入 `remarkPlugins` 数组
- [x] 2.2 修改 `web/src/components/MarkdownContent.tsx`：支持可选的 `documents` prop，当提供时启用 wikilink 插件

## 3. 样式

- [x] 3.1 在 `web/src/index.css` 或对应的 prose 样式文件中添加 `.wikilink-broken` 样式：显示为带下划线虚线的文本，颜色偏灰，提示未解析

## 4. 测试

- [x] 4.1 创建 `web/src/lib/remark-wikilink.test.ts`：测试插件的核心功能——基本链接转换、带显示文本的链接、路径解析三步策略、大小写不敏感、断链标记、行内多链接、代码块内不匹配
- [x] 4.2 验证 `DocumentViewer` 中的 wikilink 点击能正确触发 `selectDocument` 导航
