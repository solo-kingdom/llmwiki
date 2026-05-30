## Context

知识图谱页面使用 `react-force-graph-2d`（基于 d3-force）进行力导向布局。当前实现中，d3 力导向参数的配置放在 `useEffect([forceData])` 中，通过 `graphRef.current` 访问力导向引擎实例来修改 charge 和 link 力参数。

由于 `ForceGraph2D` 组件使用 `React.lazy` 异步加载，存在 Suspense 时序竞态：

```
首次加载：
  forceData 变化 → useEffect 触发 → graphRef.current 为 null（组件挂起中）→ 跳过配置
  → ForceGraph2D 加载完成并挂载 → forceData 未变化 → effect 不再触发 → 力参数永不生效

再次访问：
  lazy 模块已缓存 → 同步解析 → 组件与 effect 时序对齐 → 配置正常生效
```

默认的 d3 charge 力强度为 -30，远弱于自定义的 -120，导致节点在首次加载时聚在原点 (0,0) 无法散开。

## Goals / Non-Goals

**Goals:**
- 确保 d3 力导向参数在首次加载和后续加载中都能正确配置
- 消除 `React.lazy` + `useEffect` 的时序竞态
- 最小化代码改动，不引入新的复杂度

**Non-Goals:**
- 不改变力导向的参数值（-120, 300, 50 保持不变）
- 不替换 `react-force-graph-2d` 库
- 不移除 `React.lazy`（保留代码分割收益）
- 不添加节点持久化位置缓存（超出本次范围）

## Decisions

### Decision 1: 使用 `onEngineInit` 回调替代 `useEffect`

**选择**：将力导向参数配置从 `useEffect([forceData])` 移至 `ForceGraph2D` 的 `onEngineInit` 回调 prop。

**理由**：
- `onEngineInit` 由 `react-force-graph-2d` 内部在引擎初始化时同步调用，不受 React Suspense 时序影响
- 是库官方推荐的配置 d3 力参数的方式
- 移除了对 `graphRef` ref 的依赖（除非其他地方需要 ref）

**备选方案**：
1. ~~在 ref callback 中设置状态触发重新配置~~ — 额外引入状态，增加复杂度
2. ~~移除 lazy 改为直接 import~~ — 失去代码分割，增加首屏加载时间
3. ~~使用 `onEngineStop` 回调~~ — 引擎停止时才调用，太晚了
4. ~~给节点随机初始位置~~ — 只是缓解症状，不解决根因

### Decision 2: 移除 `graphRef` ref

**选择**：移除 `useRef<ForceGraphMethods>` 及依赖它的 `useEffect`。

**理由**：
- `graphRef` 仅用于配置力导向参数，改用 `onEngineInit` 后不再需要
- 减少不必要的状态和 effect

### Decision 3: 为节点设置随机初始位置

**选择**：在 `forceData` 的 `useMemo` 中为每个节点分配随机初始坐标（范围 ±200）。

**理由**：
- 所有节点从 (0,0) 出发时，d3-force 需要更多 tick 才能稳定
- 随机初始位置让 warmup 阶段更快收敛，减少视觉抖动
- 仅影响初始帧，不影响最终布局（力导向会收敛到相同结果）

## Risks / Trade-offs

- **[风险] `onEngineInit` 在 graphData 更新时的行为** → 如果 `graphData` prop 变化导致引擎重新初始化，`onEngineInit` 会再次调用，这是期望行为。需确认 `react-force-graph-2d` 在 props 更新时是否会触发 `onEngineInit`。根据库文档，引擎只在组件挂载时初始化一次，不会因 props 变化重新初始化，所以参数只需配置一次。
- **[权衡] 随机初始位置导致每次刷新布局不同** → 这是力导向图的正常特性（d3-force 本身就不保证确定性布局）。最终收敛状态大致相同，只是中间过程不同。
