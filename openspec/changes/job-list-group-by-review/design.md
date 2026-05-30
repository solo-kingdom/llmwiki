## Context

当前 JobsPage 平铺展示所有 `ingest_jobs` 记录。每个 job 有 `source_ref` 字段，形如 `review:<reviewID>`，用于关联到对应的归档审核（review）。当用户执行"重新规划"或"重新执行"时，后端 `EnqueueReviewPlanJob` / `EnqueueReviewApplyJob` 总是 INSERT 新 job 记录，旧的 failed/queued job 保留作为审计历史。

这导致同一 review 下产生多条 job，在平铺列表中散落展示，用户无法辨识哪条是当前活跃任务。

**当前数据结构**：

```
ingest_jobs:  id, input_type, source_ref, status, created_at, ...
ingest_reviews: id, status, final_job_id, ...
```

**前端现状**：
- `JobsPage.tsx`：每 3 秒 poll `GET /api/v1/ingest/jobs/`，直接平铺渲染
- `JobCard.tsx`：单条 job 的展示卡片
- `StatusFilter.tsx`：全局状态筛选 Tab

## Goals / Non-Goals

**Goals:**
- 同一 review 下的多个 job 按分组展示，最新活跃 job 突出显示
- 旧 job 折叠为可展开的「历史记录」区域
- 非 review 类型 job（如普通 file/text ingest、rollback）保持原样平铺
- 分组卡片支持与现有状态筛选 Tab 联动
- 不需要修改后端 API 或 store 层

**Non-Goals:**
- 不修改后端 job 创建逻辑（如去重、作废旧 job），那是层级 A/B 的范畴
- 不修改归档页（ArchiveReviewCard）的状态同步逻辑
- 不增加 SSE/WebSocket 实时推送
- 不修改 `RetryIngestJob` 的 review 联动逻辑

## Decisions

### Decision 1: 前端纯分组，不改后端 API

**选择**: 所有分组逻辑在前端完成，利用现有 `GET /api/v1/ingest/jobs/` 返回的 `source_ref` 和 `input_type` 字段。

**理由**: 
- `source_ref` 已经提供了分组所需的全部信息（`review:<id>` 格式可解析）
- 不需要新增 API 端点，减少变更范围
- 前端 `useMemo` 可以高效完成分组计算

**备选方案**: 后端新增分组端点 `GET /api/v1/ingest/jobs/grouped` — 过度设计，当前 job 数量不大，前端处理即可。

### Decision 2: 分组策略 — 仅 review 类型分组

**选择**: 只对 `source_ref` 以 `review:` 开头的 job 进行分组，其余类型平铺。

**理由**:
- 问题场景仅发生在 review 相关 job（re-plan、re-apply 产生多条记录）
- 普通 file/text job 不会产生同 source_ref 的多条记录
- 简化实现复杂度

### Decision 3: 分组卡片组件设计

**选择**: 新增 `JobGroupCard` 组件，展示 review 分组：

```
┌────────────────────────────────────────────────┐
│ 📋 归档任务  review:abc12...                    │
│ ┌──────────────────────────────────────────────┐│
│ │ [活跃] review_apply  running  2分钟前         ││
│ │ 来源: sessions/xxx/archive.md    [取消]      ││
│ └──────────────────────────────────────────────┘│
│ ▸ 历史记录 (3)                                  │
└────────────────────────────────────────────────┘
```

**分组展示规则**：
- 分组内 job 按 `created_at` 降序排列，最新的排在最前
- 最新 job 作为「活跃 job」直接展示，带有完整操作按钮
- 旧 job 折叠为「历史记录」，默认收起，点击可展开
- 展开的历史 job 只展示摘要信息（input_type、status、created_at），不提供操作按钮

### Decision 4: 状态筛选的分组适配

**选择**: 状态筛选 Tab 同时作用于分组级别和单 job 级别。

**逻辑**：
- 如果一个分组内有**任何** job 匹配当前筛选状态 → 该分组整体显示
- 分组内的活跃 job 和历史记录不受筛选状态过滤（显示该分组内的全部 job）
- 非 review 类型 job 按原有逻辑直接按状态筛选

### Decision 5: 分组排序 — 分组与平铺混合排列

**选择**: 分组和平铺 job 统一按最新活跃时间排序（created_at 降序）。

**理由**: 保持时间线的连续感，不因分组而打乱用户对时间顺序的感知。

## Risks / Trade-offs

- **[前端分组计算性能]** → 当 job 数量极大时前端分组计算可能变慢。缓解：当前 job 数量通常在百条以内，`useMemo` 开销可忽略；若后续增长，可加后端分页/过滤。
- **[source_ref 格式耦合]** → 分组逻辑硬编码 `review:` 前缀解析。缓解：此格式由后端 `ReviewSourceRef()` 函数定义，稳定不变。
- **[分组卡片复杂度]** → 新组件增加代码量。缓解：通过 `JobGroupCard` 封装，不影响现有 `JobCard` 逻辑。
