## Context

知识图谱页面（`/wiki/graph`）使用 `react-force-graph-2d` 渲染力导向图。当前布局结构为：

```
WikiReaderLayout
  └─ div.flex-1.flex-col.overflow-hidden.p-4   ← ④ 有 flex 约束
      └─ PageContainer                          ← ⑤ flex-1, overflow-y-auto
          └─ div.px-1.py-6                      ← ⑥ ⚠️ 非flex容器，斩断链路
              └─ GraphPage 容器 (flex-1 无效)
                  └─ ForceGraph2D (显式 width/height)
                      ↕ ResizeObserver 反馈循环
```

`PageContainer` 是通用组件，内部用 `<div className="px-1 py-6">` 包裹 children 并设置 `overflow-y-auto`。这对文本页面合理，但对图谱画布造成：
1. flex 链断裂 → 容器无高度约束 → canvas 撑大容器 → ResizeObserver 反馈循环
2. 节点全堆在原点附近 → 力导向参数未调优 + 字体大小无上限

后端 `GET /api/v1/graph` 无节点数量限制，当 workspace 有几千节点时会返回全量数据，前端 d3-force 无法承受。

## Goals / Non-Goals

**Goals:**
- 修复画布持续扩张的反馈循环 bug
- 修复节点/文字堆积问题
- 支持几百到几千节点的图谱流畅渲染
- 后端 API 支持按重要性截断，防止超大数据集
- 保持现有交互能力：节点点击跳转、拖拽、缩放

**Non-Goals:**
- 不更换图形库（继续使用 react-force-graph-2d）
- 不实现分层加载或后端预计算布局（留给后续优化）
- 不支持 WebGL/3D 渲染
- 不修改 PageContainer 通用组件本身

## Decisions

### Decision 1：GraphPage 跳过 PageContainer，直接渲染

**选择**：GraphPage 组件不再使用 `<PageContainer>`，直接返回自己的 flex 布局容器。

**理由**：PageContainer 的设计目标是文本滚动页面（`overflow-y-auto` + padding 包装层），图谱画布的需求完全不同：需要精确的 flex 高度约束、不能有中间层、不需要滚动。为图谱改 PageContainer 的接口会让通用组件变复杂。

**替代方案**：给 PageContainer 加 `variant="canvas"` prop → 被否决，因为一个特例不应该污染通用组件。

### Decision 2：不传显式 width/height，移除 ResizeObserver

**选择**：不再用 ResizeObserver 测量容器尺寸再传入 ForceGraph2D 的 width/height props。改为让 ForceGraph2D 自适应父容器。

**理由**：
- 一旦 flex 链修好，容器有稳定高度，ForceGraph2D 的自动尺寸检测即可正常工作
- 彻底消除 ResizeObserver ↔ Canvas 的反馈循环
- 代码更简洁，减少一个 useEffect

### Decision 3：调优力导向参数

**选择**：配置以下力导向参数：
- `d3AlphaDecay`: 0.02（更慢衰减，让模拟更充分）
- `d3VelocityDecay`: 0.3（适度阻尼）
- `charge.strength`: -120（强斥力，节点散开）
- `charge.distanceMax`: 300（限制远距离斥力计算，提升性能）
- `link.distance`: 50（连线理想距离）
- `warmupTicks`: 30（预计算，用户看到时已部分收敛）
- `cooldownTicks`: 150（更多 tick 充分收敛）
- 移除 `nodeCanvasObject` 中不必要的复杂计算

### Decision 4：后端 API 增加 limit 参数

**选择**：`GET /api/v1/graph` 增加 `?limit=N` 查询参数（默认 300），按 `link_count` 降序排列返回 top-N 节点，仅返回这些节点之间的边。

**理由**：
- 前端 force-directed layout 的实际可用上限约 300-500 节点
- 按 link_count 排序保证枢纽节点优先展示
- 只需返回子图的边，避免孤立边指向不在结果中的节点
- 后端 SQLite 查询加 LIMIT 性能开销极小

### Decision 5：字体渲染优化

**选择**：`nodeCanvasObject` 中：
- fontSize 设上下限：`Math.min(14, Math.max(6, 12 / globalScale))`
- globalScale < 0.4 时隐藏标签文字
- 节点半径根据 globalScale 自适应

## Risks / Trade-offs

- **[limit 截断丢失小节点]** → 可接受的权衡。用户先看到枢纽节点，后续可通过分层加载展开。UI 上提示当前显示的是部分节点。
- **[跳过 PageContainer 导致样式不一致]** → 风险低。GraphPage 自行处理 padding 和标题，与外层容器的 border-radius/背景由 WikiReaderLayout 已处理。
- **[300 节点上限在大型 workspace 仍然可能卡顿]** → 后续可通过 WebGL 渲染或后端预计算解决。300 是当前 force-directed 的合理上限。
- **[移除 ResizeObserver 后 ForceGraph2D 自动尺寸可能不生效]** → 需要确保父容器有明确的高度。flex 链修好后不会有问题，但需要验证。
