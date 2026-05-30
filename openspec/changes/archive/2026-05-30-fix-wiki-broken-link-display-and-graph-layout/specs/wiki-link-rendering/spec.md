## MODIFIED Requirements

### Requirement: 断链标记
当 wikilink 无法解析到任何文档时，系统 SHALL 为该链接添加 `wikilink-broken` CSS 类以提供视觉区分。断链 SHALL 通过 `react-markdown` 默认可渲染的 mdast 节点（如带 `hProperties.className` 的 link 节点）输出，SHALL NOT 依赖 raw HTML 节点或 `rehype-raw` 插件。

#### Scenario: 无法解析的链接
- **WHEN** wikilink 目标为 `nonexistent-page` 且文档列表中无匹配文档
- **THEN** 插件 SHALL 渲染一个带有 `wikilink-broken` CSS 类的元素，显示文本为原始目标
- **AND** 渲染结果 SHALL NOT 显示原始 HTML 标签文本（如 `<span class="wikilink-broken">`）

#### Scenario: 断链不触发页面导航
- **WHEN** 用户点击一个无法解析的 wikilink
- **THEN** 系统 SHALL NOT 导航到其他文档或改变当前 URL

#### Scenario: 断链在 MarkdownContent 中同样正确渲染
- **WHEN** HelpPage 或其他使用 `MarkdownContent` 的组件渲染含断链 wikilink 的内容
- **THEN** 断链 SHALL 显示为带 `wikilink-broken` 样式的元素，而非原始 HTML 文本
