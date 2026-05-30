## Why

知识图谱页面首次加载时所有节点堆叠在原点(0,0)，聚成一坨无法阅读。这是由于 `ForceGraph2D` 使用 `React.lazy` 异步加载，而配置 d3 力导向参数的 `useEffect([forceData])` 在组件因 Suspense 挂起时触发（此时 ref 为 null），待组件真正挂载后 effect 不会再次运行，导致自定义排斥力(-120)和连线距离(50)从未生效。用户离开再回来时模块已缓存、lazy 同步解析，时序恰好对上，布局就正常了。

## What Changes

- 将 d3 力导向参数的配置方式从 `useEffect` 改为 `onEngineInit` 回调，消除 Suspense 时序竞态
- 移除不再需要的 `graphRef` ref 及对应的 `useEffect([forceData])`
- 可选：为节点设置随机初始位置，减少 warmup 阶段全部从原点出发的视觉抖动

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `knowledge-graph-ui`: 修复力导向参数首次加载不生效的问题，确保无论 ForceGraph2D 是同步还是异步挂载，力导向引擎都能被正确配置

## Impact

- 前端代码：`web/src/components/GraphPage.tsx`（主要修改文件）
- 不影响 API、后端、其他组件
- 不涉及 breaking change
