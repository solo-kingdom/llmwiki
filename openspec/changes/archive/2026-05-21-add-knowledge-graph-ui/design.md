## Context

Backend 已有：
- `document_references` 表（ref_type: cites, links_to）
- MCP `search(mode="references")`
- stale/uncited 查询

Frontend 无 graph 组件。lcasastorian 使用 react-force-graph-2d；需确认 web/package.json 依赖。

## Goals / Non-Goals

**Goals:**

- 50+ 页 wiki 可视化导航
- 节点 = wiki 页面，边 = links_to（首版）
- 点击节点打开 Wiki Reader

**Non-Goals:**

- 源文件节点
- 实时协作

## Decisions

### Decision 1: API 响应格式

```json
{
  "nodes": [
    { "id": "wiki/entities/foo.md", "title": "Foo", "type": "entity", "link_count": 3 }
  ],
  "edges": [
    { "source": "wiki/concepts/bar.md", "target": "wiki/entities/foo.md", "type": "links_to" }
  ]
}
```

### Decision 2: 前端组件

- 使用 `react-force-graph-2d`（若未安装则添加依赖）
- 节点颜色按 type 分组（entity/concept/source/...）
- 中文空状态：「暂无足够页面生成图谱」

### Decision 3: 路由

- Workbench 导航新增「图谱」入口（`/graph`）
- 与 Wiki Reader 分离（管理视图）

### Decision 4: 性能

- 首版全量加载（<500 节点可接受）
- 后续可按子图/filter 优化

## Risks

| 风险 | 缓解 |
|------|------|
| 大图性能 | 限制节点数或 cluster |
| 依赖体积 | 懒加载 Graph 路由 chunk |
