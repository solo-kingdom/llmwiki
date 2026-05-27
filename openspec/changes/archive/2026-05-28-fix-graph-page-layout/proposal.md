## Why

图谱页面存在两个严重 bug：（1）页面打开后画布持续不断扩张、节点和文字不断缩小，永不停歇；（2）节点和文字堆积在一起，无法辨识。根本原因是 `PageContainer` 组件的中间 `<div className="px-1 py-6">` 包装层斩断了 flex 布局链，导致 ResizeObserver 与 ForceGraph2D 之间形成无限反馈循环；同时力导向模拟缺乏参数调优，且后端 API 无节点数量限制，大量节点时浏览器会卡死。

## What Changes

- 修复图谱页面的 flex 布局链断裂：GraphPage 跳过 PageContainer，直接渲染为 flex 容器，确保父级高度约束正确传递到图谱画布
- 移除显式 width/height + ResizeObserver 模式，改为让 ForceGraph2D 自适应容器尺寸，从根本上消除反馈循环
- 配置力导向模拟参数（电荷斥力、连线距离、阻尼等），使节点充分散开
- 优化文字渲染：增加 fontSize 上限，缩放远处隐藏标签
- 后端 graph API 增加 `limit` 查询参数，返回按连接数排序的 top-N 节点，防止超大数据集压垮前端
- 前端传入合理的 limit 参数，并在 UI 提示用户当前显示的是部分节点

## Capabilities

### New Capabilities

无新增能力。

### Modified Capabilities

- `knowledge-graph-ui`: 修复布局 bug（flex 链断裂、ResizeObserver 反馈循环）；新增 force simulation 参数调优要求；新增大图限制与提示要求；后端 API 增加 limit 参数

## Impact

- **前端**：`web/src/components/GraphPage.tsx`（主要重写）、`web/src/components/WikiReaderLayout.tsx`（GraphPage 外层容器调整）
- **后端**：`internal/api/graph.go`（增加 limit 参数）、`internal/store/sqlite/graph.go`（查询增加排序和 LIMIT）
- **测试**：`web/src/graph-page.test.tsx`（更新测试适配新行为）
- **依赖**：无新依赖，继续使用 `react-force-graph-2d`
