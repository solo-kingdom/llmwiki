## Why

Wiki 规模增长后，纯文件树和搜索不足以浏览交叉引用结构。nashsu 和 OmegaWiki 均提供力导向知识图谱可视化。本项目后端已有引用图（cites + links_to），缺前端 GraphView。属于 P2-3 体验增强，在核心 ingest/query/lint 闭环稳定后实施。

## What Changes

- 新增 `GET /api/v1/graph` 端点：返回节点（wiki 页）和边（links_to/cites）
- Web UI 新增 Graph 视图（`react-force-graph-2d` 或现有依赖）
- 导航入口：Workbench 全局导航 + Wiki Reader 可选入口
- 节点点击跳转 Wiki Reader

## Scope

### In Scope

- 图数据 API（nodes + edges + metadata）
- GraphView React 组件
- 基础力导向布局、缩放、拖拽
- 中文 UI 标签

### Out of Scope

- Louvain 社区发现（P3-2，依赖本 change）
- 边类型过滤 UI（首版展示全部 links_to）
- 3D 图谱

## Capabilities

### New Capabilities

- `knowledge-graph-api`: 引用图 JSON API
- `knowledge-graph-ui`: Web 图谱可视化视图

## Dependencies

- `add-wiki-lint` 之后（有稳定 wiki 内容测试）
- 引用图 backend 已存在（reference-graph spec）
