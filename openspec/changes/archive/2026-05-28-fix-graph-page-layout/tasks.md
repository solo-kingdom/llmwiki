## 1. 后端：Graph API 增加 limit 参数

- [x] 1.1 修改 `internal/store/sqlite/graph.go`：`BuildKnowledgeGraph` 方法增加 `limit int` 参数，节点查询按 `link_count DESC` 排序后 `LIMIT ?`；边查询增加条件只返回两端节点均在结果集中的边；返回值增加 `TotalNodes int` 和 `Truncated bool`
- [x] 1.2 修改 `internal/api/graph.go`：`KnowledgeGraph` handler 从 URL query 读取 `limit` 参数（默认 300，上限 10000），传入 store 方法；响应 JSON 增加 `truncated` 和 `total_nodes` 字段
- [x] 1.3 更新或新增后端测试：验证无 limit 时默认截断 300、自定义 limit、limit 超出总量时返回全部、truncated 字段正确

## 2. 前端：修复 GraphPage 布局与反馈循环

- [x] 2.1 重写 `GraphPage.tsx`：移除 `PageContainer` 包装，组件直接返回 `<div className="flex min-h-0 flex-1 flex-col">` 作为根容器；h1 标题和内容直接作为子元素
- [x] 2.2 移除 ResizeObserver 相关代码（`dimensions` state、ResizeObserver useEffect），不再向 ForceGraph2D 传递 `width` 和 `height` props；让组件自适应父容器
- [x] 2.3 更新 `WikiReaderLayout.tsx`：确认 GraphPage 外层容器（`div.flex.min-h-0.flex-1.flex-col.overflow-hidden`）能正确传递高度约束给 GraphPage 的 flex-1 根容器

## 3. 前端：力导向参数调优与渲染优化

- [x] 3.1 配置 ForceGraph2D 力导向参数：`d3AlphaDecay={0.02}`、`d3VelocityDecay={0.3}`、`warmupTicks={30}`、`cooldownTicks={150}`；通过 `d3ForceSetup` 或 `onEngineInit` 配置 charge strength -120、charge distanceMax 300、link distance 50
- [x] 3.2 优化 `nodeCanvasObject`：fontSize 改为 `Math.min(14, Math.max(6, 12 / globalScale))`；globalScale < 0.4 时跳过文字绘制；节点半径适当增大（基础 5，最大 14）
- [x] 3.3 前端调用 `getKnowledgeGraph` 时传入 limit 参数（默认 300）；API 响应增加 `truncated` / `total_nodes` 字段的类型定义

## 4. 前端：大图截断提示 UI

- [x] 4.1 在图谱标题旁或画布上方，当 `truncated === true` 时显示提示文字（中文），格式如"显示前 300 个枢纽节点（共 N 个）"
- [x] 4.2 添加 i18n 翻译 key：`graph.truncated_hint` 或类似

## 5. 前端测试更新

- [x] 5.1 更新 `graph-page.test.tsx`：适配 GraphPage 不再使用 PageContainer、不再传 width/height 的新行为；新增 truncated 提示渲染的测试用例
- [x] 5.2 验证 forceData 仍正确从 API 数据构建；验证 isGraphEmpty 逻辑不变
