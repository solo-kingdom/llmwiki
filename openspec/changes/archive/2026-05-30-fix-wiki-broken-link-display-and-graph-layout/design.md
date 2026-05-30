## Context

### 断链 wikilink 显示为原始 HTML

`remark-wikilink.ts` 在 wikilink 无法解析时创建 mdast `html` 节点：

```typescript
{ type: "html", value: `<span class="wikilink-broken">${escapeHtml(displayText)}</span>` }
```

`DocumentViewer` 和 `MarkdownContent` 使用 `react-markdown` 渲染，未启用 `rehype-raw`。在默认配置下，mdast `html` 节点会被转义为纯文本，用户看到 `<span class="wikilink-broken">entities/langchain</span>` 而非带样式的断链元素。

成功解析的 wikilink 使用 `link` 节点，渲染正常。问题仅影响断链路径。

用户报告的 `entities/langchain`、`entities/openai-codex` 可能是：
1. 真实断链（对应 wiki 页面不存在）——修复后应显示为灰色虚线样式而非 HTML 文本
2. 误判断链（页面存在但解析失败）——需验证五步解析策略是否覆盖 `entities/xxx` 路径格式

### 知识图谱首次加载节点聚集

`GraphPage.tsx` 通过 `useEffect([forceData])` + `fgRef.current` 配置 d3 charge(-120) 和 link distance(50)。`ForceGraph2D` 使用 `React.lazy` 异步加载，Suspense 挂起时 effect 触发但 ref 为 null，配置被跳过。再次访问时 lazy 模块已缓存，时序对齐，布局正常。

`openspec/specs/knowledge-graph-ui/spec.md` 已要求通过 `onEngineInit` 配置力参数，但代码尚未实现。

## Goals / Non-Goals

**Goals:**
- 断链 wikilink 在 Wiki 阅读器中正确渲染为带 `wikilink-broken` 样式的元素
- 知识图谱首次加载时节点正确散开，无需离开再回来
- 最小化改动，不引入 `rehype-raw`（避免 XSS 面扩大）
- 补充测试验证两个修复

**Non-Goals:**
- 不修改后端 wikilink 解析逻辑（除非测试发现前端误判且与后端不一致）
- 不修改 LLM ingest prompt 以减少 HTML 输出（可作为后续改进）
- 不改变力导向参数值（-120, 300, 50 保持不变）
- 不移除 `React.lazy` 代码分割

## Decisions

### Decision 1: 断链使用 link 节点 + hProperties 而非 html 节点

**选择**：将无法解析的 wikilink 输出为 mdast `link` 节点，`url` 设为 `#`，并通过 `data.hProperties` 附加 `className: 'wikilink-broken'`。

**理由**：
- `react-markdown` 原生渲染 `link` 节点，无需 `rehype-raw`
- `hProperties` 是 remark/rehype 生态的标准扩展方式
- 可在 `components.a` 中拦截 `#` 链接阻止默认跳转

**备选方案**：
1. ~~启用 `rehype-raw`~~ — 扩大 XSS 攻击面，wiki 内容由 LLM 生成，风险较高
2. ~~继续使用 html 节点 + rehype-raw 白名单~~ — 复杂度高于 link 方案
3. ~~自定义 remark-rehype 插件注册新节点类型~~ — 过度工程

### Decision 2: 在 DocumentViewer / MarkdownContent 添加断链 link 拦截

**选择**：在现有 `onClick` 委托中增加对 `a.wikilink-broken` 或 `href="#"` 的处理，阻止导航。

**理由**：断链 link 的 `url` 为 `#`，不拦截会导致页面跳转到顶部。

### Decision 3: 使用 onEngineInit 替代 useEffect 配置力参数

**选择**：将 charge 和 link 力参数配置移至 `ForceGraph2D` 的 `onEngineInit` 回调，移除 `useEffect([forceData])` 和 `fgRef`（若 ref 无其他用途）。

**理由**：
- `onEngineInit` 在引擎初始化时同步调用，不受 Suspense 时序影响
- 与已有 spec 和 archive 设计一致
- 库官方推荐方式

### Decision 4: 保留随机初始位置

**选择**：继续在 `forceData` useMemo 中为节点分配随机初始坐标（±200 范围）。

**理由**：减少所有节点从 (0,0) 出发时的 warmup 抖动，与 archive 设计一致。

## Risks / Trade-offs

- **[误判断链]** `entities/langchain` 若页面实际存在但仍显示断链 → 实现后手动验证；若仍失败则单独排查 slug 索引或文档列表加载时序
- **[hProperties 兼容性]** 需确认当前 `react-markdown` + `remark-gfm` 版本正确传递 `hProperties` → 测试覆盖
- **[onEngineInit 仅挂载时调用]** graphData 热更新时力参数不重新配置 → 当前图谱数据仅在 mount 时 fetch 一次，无热更新场景，可接受

## Migration Plan

纯前端修复，无数据迁移。部署后：
1. 刷新 Wiki 页面，确认断链显示为灰色虚线样式而非 HTML 文本
2. 首次打开知识图谱，确认节点立即散开
3. 若 `entities/langchain` 等仍为断链且页面确实存在，检查 wiki 文件路径并运行 `llmwiki reindex`

## Open Questions

- `entities/langchain` 和 `entities/openai-codex` 在用户的 workspace 中是否真实存在对应 `.md` 文件？若不存在，断链样式是正确的，用户需补充页面或修正 wikilink 目标
