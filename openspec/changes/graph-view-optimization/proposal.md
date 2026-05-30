## Why

知识图谱页面顶部仍显示「知识图谱」标题，占用垂直空间且与 Wiki 阅读器侧栏导航重复；画布未能铺满父容器，视觉体验像嵌入的小窗口而非沉浸式图谱视图。同时，首次打开图谱时节点仍聚集在一点——规范已要求通过 `onEngineInit` 配置力导向参数，但当前 `GraphPage.tsx` 仍使用 `useEffect([forceData])` + `ref` 方式，与 `React.lazy` 存在时序竞态，导致首次加载 charge/link 力参数未生效。

## What Changes

- 移除图谱页面顶部的「知识图谱」标题（`h1`），导航入口已足够标识当前视图
- 调整 `GraphPage` 布局，使力导向画布铺满父容器（`WikiReaderLayout` 中的 flex 区域），去除多余 margin/padding 占用
- 将截断提示（truncated hint）改为画布内浮层 overlay，不占用布局高度
- 排查并修复节点初始化聚集问题：将 d3 力参数配置从 `useEffect` 迁移至 `onEngineInit`（规范已定义、测试已覆盖、实现未落地）
- 若 `onEngineInit` 修复后仍有问题，评估移除 `React.lazy` 或重构力导向初始化逻辑
- 更新前端测试以匹配无标题、全屏布局与 `onEngineInit` 行为

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `knowledge-graph-ui`: 图谱视图 SHALL 无页面级标题、画布 SHALL 铺满父容器；截断提示 SHALL 以 overlay 形式展示；力导向参数 SHALL 通过 `onEngineInit` 配置（落地已有规范）

## Impact

- 前端: `web/src/components/GraphPage.tsx`、`web/src/components/WikiReaderLayout.tsx`（可能需调整外层 padding）
- 测试: `web/src/graph-page.test.tsx`
- i18n: `graph.title` 键可保留供导航使用，页面内不再引用
- 后端: 无变更
