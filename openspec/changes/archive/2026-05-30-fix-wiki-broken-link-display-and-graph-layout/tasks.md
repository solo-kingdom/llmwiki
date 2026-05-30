## 1. 断链 wikilink 渲染修复

- [x] 1.1 修改 `web/src/lib/remark-wikilink.ts`：将无法解析的 wikilink 从 `html` 节点改为 `link` 节点（`url: '#'`），通过 `data.hProperties.className: 'wikilink-broken'` 附加样式类
- [x] 1.2 修改 `web/src/components/DocumentViewer.tsx`：在 wikilink 点击委托中拦截 `a.wikilink-broken` 或 `href="#"` 的断链，阻止默认导航
- [x] 1.3 修改 `web/src/components/MarkdownContent.tsx`：同步添加断链点击拦截（若该组件有独立点击处理）
- [x] 1.4 确认 `.wikilink-broken` 样式在 `web/src/App.css` 中对 `a.wikilink-broken` 同样生效（必要时补充选择器）

## 2. 断链 wikilink 测试

- [x] 2.1 更新 `web/src/lib/remark-wikilink.test.ts`：断链断言改为检查 `wikilink-broken` class 出现在渲染 HTML 中，且不含转义的 `<span` 原始文本
- [x] 2.2 添加测试：渲染结果中不包含字面量 `<span class="wikilink-broken">` 字符串

## 3. 知识图谱首次加载布局修复

- [x] 3.1 修改 `web/src/components/GraphPage.tsx`：将 d3 charge(-120, distanceMax 300) 和 link distance(50) 配置从 `useEffect([forceData])` 迁移至 `ForceGraph2D` 的 `onEngineInit` 回调
- [x] 3.2 移除不再需要的 `fgRef` ref 及对应的 `useEffect`（若 ref 无其他用途）
- [x] 3.3 确认 `forceData` useMemo 中节点随机初始位置逻辑保留

## 4. 知识图谱测试与验收

- [x] 4.1 更新 `web/src/graph-page.test.tsx`：验证 `onEngineInit` 被调用且力参数正确配置（mock ForceGraph2D 时检查 prop）
- [ ] 4.2 手动验收：首次打开知识图谱，节点应立即散开而非聚集在原点
- [ ] 4.3 手动验收：Wiki 页面中断链 wikilink 显示为灰色虚线样式，而非原始 HTML 文本

## 5. 断链路径排查（可选）

- [x] 5.1 验证 `entities/langchain`、`entities/openai-codex` 在用户 workspace 中是否存在对应 wiki 文件；若存在但仍断链，排查五步解析策略是否遗漏并补充测试
