## Context

知识图谱由 `GraphPage` 组件渲染，嵌入 `WikiReaderLayout` 的主内容区。当前结构：

```
WikiReaderLayout
  └─ div.flex.min-h-0.flex-1.flex-col.p-4   ← 外层卡片 padding
      └─ GraphPage
          ├─ div.mb-2 (h1「知识图谱」+ truncated hint)   ← 占用垂直空间
          └─ div.flex-1 (canvas container + ForceGraph2D)
```

`ForceGraph2D` 通过 `React.lazy` 异步加载。力导向参数（charge -120、link distance 50 等）当前在 `useEffect([forceData])` 中通过 `fgRef.current.d3Force()` 配置。

**节点聚集根因（已确认）**：`React.lazy` + Suspense 导致首次加载时序竞态——`forceData` 变化触发 `useEffect` 时 `ForceGraph2D` 尚未挂载，`fgRef.current` 为 null，配置被跳过；lazy 模块缓存后再次访问时组件同步挂载，配置正常生效。此问题在 `2026-05-28-fix-graph-initial-layout` 变更中已分析，`knowledge-graph-ui` 规范已要求 `onEngineInit`，但 `GraphPage.tsx` 实现未迁移。

当前代码已有随机初始位置（±200），但默认 charge 强度 -30 仍不足以在 warmup 阶段散开节点。

## Goals / Non-Goals

**Goals:**
- 移除页面级「知识图谱」标题，画布铺满父容器可用空间
- 修复首次加载节点聚集问题，优先通过 `onEngineInit` 落地已有规范
- 截断提示改为画布内 overlay，不挤占布局高度
- 保持现有交互：节点点击跳转、拖拽、缩放、类型着色

**Non-Goals:**
- 不更换 `react-force-graph-2d` 库
- 不修改后端 graph API
- 不实现节点位置持久化或 WebGL 渲染
- 不移除 `React.lazy`（除非 `onEngineInit` 修复验证失败）

## Decisions

### Decision 1: 移除页面标题，全屏画布布局

**选择**：删除 `GraphPage` 内 `<h1>{t("graph.title")}</h1>`；根容器改为 `flex min-h-0 flex-1 flex-col h-full`，canvas 容器 `flex-1 min-h-0 h-full w-full`，去除 `mb-2` 和 canvas 外层 `rounded-lg border`（边框由 `WikiReaderLayout` 卡片提供）。

**理由**：侧栏已有「图谱」导航项标识当前视图；标题重复且占用 ~40px 垂直空间，导致画布无法铺满。

**截断提示**：移至 canvas 容器内绝对定位 overlay（`absolute top-2 left-2 text-xs`），半透明背景，仅在 `truncated: true` 时显示。

### Decision 2: 使用 `onEngineInit` 替代 `useEffect` + `ref`

**选择**：提取 `configureForceEngine(fg)` 函数，在 `ForceGraph2D` 的 `onEngineInit` prop 中调用；移除 `fgRef` 及 `useEffect([forceData])`。

```typescript
function configureForceEngine(fg: ForceGraphMethods) {
  fg.d3Force("charge")?.strength(-120).distanceMax(300)
  fg.d3Force("link")?.distance(50)
}

<ForceGraph2D onEngineInit={configureForceEngine} ... />
```

**理由**：`onEngineInit` 在引擎初始化时同步调用，不受 Suspense 时序影响；是 `react-force-graph-2d` 官方推荐方式；与现有规范及测试一致。

**备选方案**：
1. ~~保留 useEffect + ref~~ — 已证实存在竞态，不采用
2. ~~移除 lazy 直接 import~~ — 作为 fallback，仅在 Decision 2 验证失败时启用
3. ~~增大随机初始位置范围~~ — 缓解症状，不解决根因

### Decision 3: 调整 WikiReaderLayout 外层 padding（按需）

**选择**：图谱视图的外层卡片保留 `p-4`，但 `GraphPage` 内部用 `-m-4` 或让 `WikiReaderLayout` 对 graph 视图使用 `p-0` 使画布真正 edge-to-edge。

**理由**：若仅删标题但保留双层 padding，画布仍无法「铺满」。优先在 `WikiReaderLayout` 的 graph 分支去掉 `p-4`，或在 `GraphPage` 根元素用负 margin 抵消。

**推荐**：`WikiReaderLayout` graph 分支改为 `p-0 overflow-hidden`，loading/error/empty 状态在 `GraphPage` 内居中显示。

### Decision 4: 测试策略

**选择**：
- 移除对 `heading「知识图谱」` 的断言
- 保留/强化 `onEngineInit` 调用断言（mock 需检测 `onEngineInit` prop 而非 `ref`）
- 新增 canvas 容器 `h-full`/`flex-1` class 或 `data-testid` 布局断言

## Risks / Trade-offs

- **[onEngineInit 在 graphData 热更新时不重跑]** → 引擎只在挂载时初始化一次；当前图谱数据仅在 mount 时 fetch，无热更新场景，可接受
- **[去掉标题后新用户不知当前页面]** → 侧栏高亮「图谱」已足够；截断 overlay 保留信息提示
- **[p-0 导致 loading/error 文字贴边]** → loading/error/empty 状态在 `GraphPage` 内用 `flex items-center justify-center p-4` 居中
- **[onEngineInit 仍无法修复]** → fallback：移除 `React.lazy` 改为静态 import，或增加 `onEngineStop` + 检测节点坐标方差触发 reheat

## Migration Plan

1. 修改 `GraphPage.tsx`：布局 + `onEngineInit`
2. 按需调整 `WikiReaderLayout.tsx` graph 分支 padding
3. 更新 `graph-page.test.tsx`
4. 手动验证：首次打开 `/wiki/graph` 节点应散开；刷新、离开再回来行为一致

## Open Questions

- 无。根因已明确，实现路径遵循已有规范。
