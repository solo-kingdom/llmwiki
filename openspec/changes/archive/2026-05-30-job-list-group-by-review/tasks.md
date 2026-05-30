## 1. 分组工具函数

- [x] 1.1 在 `web/src/lib/` 下新增 `job-grouping.ts`，实现 `groupByReview(jobs: IngestJob[])` 函数：按 `source_ref` 以 `review:` 开头的 job 分组，返回 `Map<string, IngestJob[]>`（key 为 source_ref），以及不属于任何分组的平铺 job 数组
- [x] 1.2 在同一文件中实现 `activeJobOfGroup(jobs: IngestJob[]): IngestJob` 辅助函数：返回分组内 `created_at` 最新的 job
- [x] 1.3 为分组工具函数编写单元测试 `job-grouping.test.ts`，覆盖：空列表、全是 review job、全是非 review job、混合情况、单条 review job 分组

## 2. JobGroupCard 组件

- [x] 2.1 新建 `web/src/components/JobGroupCard.tsx`，接收 `jobs: IngestJob[]`、`onRetry`、`onCancel`、`onPreviewSource`、`onViewLog` props
- [x] 2.2 实现 JobGroupCard 主体：展示最新活跃 job 的完整信息（来源路径、输入类型、状态标签），复用现有 JobCard 的展示逻辑
- [x] 2.3 实现活跃 job 的操作按钮（Retry/Cancel/Restart），调用父组件传入的回调
- [x] 2.4 实现「历史记录 (N-1)」折叠/展开区域，默认收起，点击切换
- [x] 2.5 展开时显示历史 job 摘要列表（input_type、status 标签、created_at），不提供操作按钮
- [x] 2.6 分组标题区域显示归档来源信息（从活跃 job 的 `source_path` 提取文件名）
- [x] 2.7 为 JobGroupCard 编写测试 `JobGroupCard.test.tsx`，覆盖：单 job 不显示历史记录、多 job 显示折叠区域、操作按钮调用正确回调、展开/收起交互

## 3. JobsPage 集成分组

- [x] 3.1 修改 `web/src/components/JobsPage.tsx`，使用 `groupByReview` 对 `ingestJobs` 进行分组计算，用 `useMemo` 缓存
- [x] 3.2 实现混合渲染逻辑：遍历分组+平铺的统一排序列表，分组渲染 `JobGroupCard`，平铺渲染 `JobCard`
- [x] 3.3 适配状态筛选 Tab：选中非 "all" 状态时，过滤分组维度（分组内有任何 job 匹配则保留该分组）和平铺维度
- [x] 3.4 确保 JobGroupCard 内的操作（Retry/Cancel/日志预览/来源预览）与 JobsPage 现有功能正确集成（回调透传）
- [x] 3.5 编写 `JobsPage` 集成测试，覆盖分组渲染、筛选联动、混合排序

## 4. 类型与 i18n

- [x] 4.1 在 `web/src/types.ts` 中检查 `IngestJob` 类型是否已包含 `source_ref` 字段，如缺少则补充
- [x] 4.2 在 `web/src/i18n/` 中添加分组卡片相关的翻译 key（如历史记录文案、折叠按钮文案）
