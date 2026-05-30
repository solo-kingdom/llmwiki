## 1. 布局优化

- [x] 1.1 移除 `GraphPage` 顶部 `<h1>{t("graph.title")}</h1>` 标题行
- [x] 1.2 调整 `GraphPage` 根容器与 canvas 容器 class，使画布 `flex-1 min-h-0 h-full w-full` 铺满父元素
- [x] 1.3 将 truncated hint 改为 canvas 容器内绝对定位 overlay（`absolute top-2 left-2`）
- [x] 1.4 调整 `WikiReaderLayout` 图谱分支外层 padding（graph 视图用 `p-0`，loading/error/empty 在 GraphPage 内居中）

## 2. 修复节点初始化聚集

- [x] 2.1 提取 `configureForceEngine(fg)` 函数，配置 charge.strength(-120)、distanceMax(300)、link.distance(50)
- [x] 2.2 将力导向参数配置从 `useEffect([forceData])` + `fgRef` 迁移至 `ForceGraph2D` 的 `onEngineInit` prop
- [x] 2.3 移除不再需要的 `fgRef` 和 `useEffect` 代码
- [x] 2.4 手动验证：首次打开 `/wiki/graph` 节点应散开，刷新与再次访问行为一致
- [x] 2.5 （Fallback）若 `onEngineInit` 仍无法修复，移除 `React.lazy` 改为静态 import

## 3. 测试更新

- [x] 3.1 更新 `graph-page.test.tsx`：移除对「知识图谱」heading 的断言
- [x] 3.2 更新 mock：检测 `onEngineInit` prop 被调用（而非 `ref`）
- [x] 3.3 补充 truncated overlay 位置/可见性测试
- [x] 3.4 运行 `npm test -- graph-page` 确保全部通过
