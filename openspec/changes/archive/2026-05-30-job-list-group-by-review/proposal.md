## Why

当前任务页（JobsPage）平铺展示所有 ingest_jobs 记录，未按 source_ref 分组。当用户对归档执行"重新规划"或"重新执行"时，后端会创建新的 job 记录（保留旧记录用于审计），导致同一归档任务的多个 job 散落在列表中。用户无法区分哪条是当前活跃任务、哪条是历史记录，造成困惑。

## What Changes

- JobsPage 前端按 `source_ref`（即 `review:<id>`）对任务进行分组展示
- 同一归档任务（review）下的多个 job 聚合为一个分组卡片
- 分组卡片展示最新活跃 job 的状态，旧 job 折叠为「历史记录」
- 非 review 类型的 job（如普通 file/text ingest）保持原样单独展示

## Capabilities

### New Capabilities

- `job-list-grouping-ui`: 任务列表按归档任务分组的展示能力，包括分组卡片 UI、折叠历史记录、活跃 job 突出显示

### Modified Capabilities

- `jobs-page-ui`: 任务列表展示逻辑从平铺改为分组 + 平铺混合模式

## Impact

- **前端**: `JobsPage.tsx`、`JobCard.tsx` 需要重构；可能新增 `JobGroupCard.tsx` 组件
- **后端 API**: 无变更，现有 `GET /api/v1/ingest/jobs/` 返回的数据已包含 `source_ref` 和 `input_type` 字段，足够前端分组
- **Store 层**: 无变更
