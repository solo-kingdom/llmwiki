## Context

Wiki Reader（`/wiki`）与管理 Workbench（`/`, `/ingest`, …）已分离。Reader 通过 `ListDocuments` 加载全量文档建树（含 `raw/`），搜索仅传 `q`，图谱在 Workbench `/graph`。后端已有 `source_kind`、引用图 `links_to`、`BuildKnowledgeGraph` 的 path→type 映射（`entities`→`entity` 等），以及 `SearchChunks` 的 `pathFilter`（`wiki` / `sources`）。

产品决策：Wiki 只浏览 `wiki/` 总结知识；侧栏 = 类型筛选 + 实体列表 + 目录树；搜索 = 全文 ∧ 类型；全局图谱迁入 Wiki；`source` 类型 UI 称「来源摘要」。

## Goals / Non-Goals

**Goals:**

- Wiki 列表/树/搜索/图谱均限定 `source_kind=wiki`
- 侧栏：类型 chips、实体扁平列表、过滤后的 wiki 目录树
- `GET /api/v1/search` 支持 `types` 查询参数（多值 OR，与 `q` AND）
- 图谱路由 `/wiki/graph`，Reader 顶栏入口；Workbench 移除 Graph 导航
- 中文 UI：`source` →「来源摘要」

**Non-Goals:**

- Backlinks / 出链面板、局部子图、断链高亮
- Timeline / raw 文件管理 UI
- MCP search 模式变更（可后续对齐 `types`）
- 修改图谱 API 响应格式

## Decisions

### Decision 1: 页面类型解析

复用 `graph.go` 中 `wikiPageType(relative_path)` 规则（`wiki/entities/` → `entity`，`wiki/sources/` → `source` 等）。列表与搜索过滤均用同一函数，避免 frontmatter 与目录不一致时的分叉逻辑。

**备选**：仅解析 YAML `type` 字段 — 拒绝，因索引阶段已以目录为主，且 lint 要求二者一致。

### Decision 2: 文档列表 API

扩展 `GET /api/v1/documents`：

| 参数 | 行为 |
|------|------|
| `source_kind=wiki`（Wiki 默认） | 仅返回 wiki 页 |
| `type=entity`（可选） | 再按 page_type 过滤 |

响应 `DocumentListItem` 增加 `relative_path`、`source_kind`、`page_type`（供前端筛选，无需二次推断）。

公开 Wiki `listPublicDocuments` 同步过滤与字段（仅 wiki）。

### Decision 3: 搜索 API

`GET /api/v1/search?q=...&types=entity,concept`：

- 无 `types`：默认 `pathFilter=wiki`（与今日 `filter=wiki` 对齐）
- 有 `types`：FTS 命中后 JOIN `documents`，保留 `source_kind=wiki` 且 `page_type IN (...)` 
- 类型多选 OR；与 `q` AND
- `q` 为空且仅有 types 时：返回该类型下文档的标题匹配列表或最近更新列表（实现可选：要求 `q` 非空首版，types 仅缩小全文结果 — **首版采用：必须 `q` 非空**，types 仅作窄化，避免空搜全表）

### Decision 4: Wiki 路由

| 路径 | 壳 |
|------|-----|
| `/wiki`, `/wiki?doc=` | Reader 三栏 |
| `/wiki/graph` | 同 Wiki 顶栏，主区渲染 `GraphPage` |

`isWikiReaderPath` 已覆盖 `/wiki/*`。`WikiReaderLayout` 根据 pathname 切换主内容（文档 vs 图谱）。

Workbench `NAV_ITEMS` 移除 `graph`；`/graph` 可 302 或客户端重定向到 `/wiki/graph`（避免书签失效）。

### Decision 5: 侧栏结构（自上而下）

1. 类型筛选 chips（全部 / entity / concept / 来源摘要 / …）
2. 实体列表（固定区块，仅 `page_type=entity`，按 title 排序；受 chips 影响：选非 entity 类型时列表可隐藏或为空）
3. `wiki/` 目录树（`buildTree` 输入已过滤；不含 `raw/`）

类型 chip 与树、实体列表联动：选中「concept」时树只显示 concept 路径，实体列表隐藏。

### Decision 6: 类型展示名

| `page_type` | 中文标签 |
|-------------|----------|
| `entity` | 实体 |
| `concept` | 概念 |
| `source` | 来源摘要 |
| `synthesis` | 综合 |
| `comparison` | 对比 |
| `query` | 查询 |

i18n key 如 `wiki.type.source` = 「来源摘要」。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| `ListDocuments` 破坏其他调用方 | 默认无参数仍返回全量；Wiki 显式传 `source_kind=wiki` |
| 搜索 `types` 需 JOIN 性能 | wiki 规模 <500 可接受；后续可加 `documents.page_type` 列缓存 |
| `/graph` 旧链接 | 重定向到 `/wiki/graph` |
| 侧栏三块占高度 | 实体列表可折叠，默认展开 |

## Migration Plan

1. 后端：list + search 扩展，补测试
2. 前端：WikiReaderContext 用 wiki-only list；侧栏与 SearchModal；路由与 Workbench 导航
3. 重定向 `/graph` → `/wiki/graph`
4. 更新 e2e / `wiki-reader.test.tsx`、`graph-page.test.tsx` 路径

无数据迁移；SQLite schema 可选后续加 `page_type` 列，首版运行时从 path 推导。

## Open Questions

- 无（产品侧已在 explore 阶段拍板）
