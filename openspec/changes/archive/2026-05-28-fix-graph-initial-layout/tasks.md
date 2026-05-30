## 1. 修复力导向参数配置时序

- [x] 1.1 在 `ForceGraph2D` 组件上添加 `onEngineInit` 回调，将 charge strength(-120)、distanceMax(300)、link distance(50) 的配置从 `useEffect([forceData])` 迁移至此回调
- [x] 1.2 移除 `graphRef` ref（`useRef<ForceGraphMethods>`）及依赖它的 `useEffect([forceData])` 块
- [x] 1.3 清理不再需要的 import：移除 `ForceGraphMethods` 类型导入（如无其他引用）

## 2. 优化节点初始位置

- [x] 2.1 在 `forceData` 的 `useMemo` 中为每个节点分配随机初始坐标（x, y 范围 ±200），避免所有节点从原点 (0,0) 同时出发

## 3. 验证

- [ ] 3.1 手动测试：首次访问 `/wiki/graph`，确认节点正常散开、不再堆叠在原点
- [ ] 3.2 手动测试：点击节点跳转到 wiki 页面后返回图谱，确认布局仍然正常
- [x] 3.3 运行现有测试：`pnpm test`（web 目录下），确认 `graph-page.test.tsx` 通过
