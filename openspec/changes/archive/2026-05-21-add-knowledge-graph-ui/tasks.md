## 1. Backend API

- [x] 1.1 新增 `internal/api/graph.go`
- [x] 1.2 从 store 查询 wiki 文档 + references 构建 nodes/edges
- [x] 1.3 注册 `GET /api/v1/graph` 路由
- [x] 1.4 API 测试

## 2. Frontend

- [x] 2.1 添加 `react-force-graph-2d` 依赖（若缺失）
- [x] 2.2 新增 `GraphPage.tsx` 组件
- [x] 2.3 新增 `/graph` 路由与导航入口
- [x] 2.4 i18n 中文文案（标题、空状态、加载）
- [x] 2.5 节点点击跳转 Wiki Reader
- [x] 2.6 节点颜色按 type 区分

## 3. 测试与验收

- [x] 3.1 前端组件测试（mock API）
- [x] 3.2 手工验收：20+ 页 workspace 图谱可交互
- [x] 3.3 运行 `go test ./internal/api/...` 与 `npm test`（graph 相关）
