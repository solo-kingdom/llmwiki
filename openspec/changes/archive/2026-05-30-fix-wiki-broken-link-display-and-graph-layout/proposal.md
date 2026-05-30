## Why

Wiki 阅读器中无法解析的 wikilink 显示为原始 HTML 字符串（如 `<span class="wikilink-broken">entities/langchain</span>`），而非带样式的断链标记。根因是 remark 插件将断链输出为 mdast `html` 节点，而 `react-markdown` 默认不渲染原始 HTML，导致标签被转义为纯文本。同时，知识图谱首次打开时节点聚集在一点，离开再回来才正常散开——这是 `ForceGraph2D` 的 `React.lazy` 与 `useEffect` 配置 d3 力参数的时序竞态，此前已有设计但未落地到代码。

## What Changes

- 修复断链 wikilink 的渲染方式：改用 `react-markdown` 可正确渲染的 mdast 节点（如带 `hProperties` 的 link 节点 + 自定义组件），不再输出 raw `html` 节点
- 排查 `entities/langchain` 等路径是否因文档列表未就绪或解析策略遗漏而误判为断链，必要时补充解析或加载时序保障
- 将知识图谱 d3 力导向参数配置从 `useEffect([forceData])` 迁移至 `onEngineInit` 回调，消除 Suspense 时序竞态
- 保留节点随机初始位置以加速 warmup 收敛
- 补充前端测试覆盖断链视觉渲染与图谱首次加载布局

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wiki-link-rendering`: 断链标记 SHALL 通过可渲染的 mdast 节点输出，确保在默认 `react-markdown` 配置下显示为带 `wikilink-broken` 样式的元素而非原始 HTML 文本
- `knowledge-graph-ui`: 力导向参数 SHALL 通过 `onEngineInit` 配置（规范已定义，本次落地实现）

## Impact

- 前端: `web/src/lib/remark-wikilink.ts`、`web/src/components/DocumentViewer.tsx`、`web/src/components/MarkdownContent.tsx`、`web/src/components/GraphPage.tsx`
- 测试: `web/src/lib/remark-wikilink.test.ts`、`web/src/graph-page.test.tsx`
- 样式: `web/src/App.css`（`.wikilink-broken` 已有，可能需微调）
- 后端: 无变更（若断链为真实缺失页面，需用户补充 wiki 内容或 reindex）
