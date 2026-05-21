## 1. 后端数据模型与存储

- [x] 1.1 设计并新增 review 相关表结构（`ingest_reviews`, `ingest_review_messages`, `ingest_review_plans`）及索引
- [x] 1.2 为 sqlite store 增加 review 的 CRUD 与状态流转方法
- [x] 1.3 增加 review 状态机校验（禁止非法跳转）
- [x] 1.4 为 review 计划版本增加读写接口（按 version 递增）

## 2. 归档入口与审核流程 API

- [x] 2.1 改造 `POST /api/v1/ingest/sessions/{id}/archive`：从“直接建 job”改为“创建 review + 启动规划”
- [x] 2.2 新增 Review API：
  - [x] `GET /api/v1/ingest/reviews`
  - [x] `GET /api/v1/ingest/reviews/{id}`
  - [x] `GET /api/v1/ingest/reviews/{id}/plans`
  - [x] `POST /api/v1/ingest/reviews/{id}/feedback`
  - [x] `POST /api/v1/ingest/reviews/{id}/replan`
  - [x] `POST /api/v1/ingest/reviews/{id}/approve`
- [x] 2.3 归档返回体增加 `review_id` 与审核跳转所需字段

## 3. 规划与执行引擎改造

- [x] 3.1 拆分 pipeline 语义：`plan` 阶段与 `apply` 阶段
- [x] 3.2 实现计划阶段“禁止写文件”护栏
- [x] 3.3 实现审核通过后的执行链路：基于最终计划重生成 FILE blocks 再执行
- [x] 3.4 将 apply 执行结果回写 review（`final_job_id`, `status`）
- [x] 3.5 执行失败后允许从 Review 页面触发“重新规划”

## 4. 前端 Review 页面与交互

- [x] 4.1 新增独立 Review 页面与导航入口（Workbench 新增 `review` 视图）
- [x] 4.2 新增 review 列表与详情展示
- [x] 4.3 新增计划版本浏览区（v1/v2/v3...）
- [x] 4.4 新增自然语言反馈输入与提交
- [x] 4.5 新增“重新规划”操作（失败/未通过场景）
- [x] 4.6 新增“审核通过”操作（触发 apply）
- [x] 4.7 调整 Chat 归档行为：归档成功后停留 Chat，仅提示“去审核”

## 5. 回滚与可观测性

- [x] 5.1 确保最终 apply 产物可按 job 粒度回滚
- [x] 5.2 记录 review 生命周期事件（planning/reviewing/approved/applying/failed）
- [x] 5.3 在 Jobs 与 Review 之间建立可追踪链接（job_id <-> review_id）

## 6. 测试与验证

- [x] 6.1 后端单测：review 状态机、计划版本递增、批准后执行触发
- [x] 6.2 后端集成测：session archive -> review -> replan -> approve -> apply
- [x] 6.3 前端测试：Review 页面反馈、重新规划、审核通过、失败恢复
- [x] 6.4 回归测试：Chat 归档后停留当前页并出现审核引导
- [x] 6.5 回归测试：批准后确实重生成 FILE blocks，而非复用旧结果
