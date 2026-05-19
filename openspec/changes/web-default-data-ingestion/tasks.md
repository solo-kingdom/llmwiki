## 1. Ingest 任务模型与存储

- [x] 1.1 设计并创建 ingest job 数据结构与持久化表（状态、输入类型、错误字段、重试链路）
- [x] 1.2 定义 job 生命周期状态流转与状态校验（queued/running/succeeded/failed/cancelled）
- [x] 1.3 实现 job 查询接口所需的 store 层方法（按 ID 查询、列表查询、结果摘要）
- [x] 1.4 实现失败结构化字段（error_code、message、missing_dependency、remediation）

## 2. Ingest API（Web-first）

- [x] 2.1 新增 ingest API 路由（创建任务、查询状态、查询结果、重试、取消）
- [x] 2.2 实现“对话草稿确认后创建任务”接口与参数校验
- [x] 2.3 实现“文本提交创建任务”接口，并完成文件先落盘后入队流程
- [x] 2.4 实现“文件上传创建任务”接口，支持多文件 accepted/rejected 返回
- [x] 2.5 为 ingest API 补充 HTTP 集成测试（成功、失败、重试、取消）

## 3. 摄入管线扩展（多输入统一）

- [x] 3.1 实现输入归一化层（对话草稿/文本/上传文件 → canonical ingest source）
- [x] 3.2 将归一化输入接入现有两步 LLM 管线（analysis/generation）
- [x] 3.3 扩展队列处理逻辑以记录 attempt lineage 与用户触发重试
- [x] 3.4 实现格式能力分层失败分类并输出结构化诊断
- [x] 3.5 补充 ingest pipeline 单元测试（多输入、失败分类、重试链路）

## 4. 工作区落盘与重建一致性

- [x] 4.1 定义 Web 摄入输入在工作区的落盘路径规范（raw/sources 或约定 inbox）
- [x] 4.2 确保文本与上传输入在“落盘成功”前不进入队列
- [x] 4.3 补充 reindex 相关验证，确认 web-ingested sources 可从文件系统重建
- [x] 4.4 补充异常场景测试（磁盘/权限失败时拒绝接收任务）

## 5. Web Ingest Hub 与默认入口改造

- [x] 5.1 调整 Web 顶层信息架构，将默认入口切换为 Ingest Hub
- [x] 5.2 新增对话式摄入 UI（会话输入、草稿确认、提交任务）
- [x] 5.3 新增文本提交 UI（文本编辑、提交校验、提交反馈）
- [x] 5.4 新增文件上传 UI（多文件上传、accepted/rejected 明细）
- [x] 5.5 保留并重接 Wiki 浏览入口，确保原有浏览流程可达

## 6. 状态可观测性与用户反馈

- [x] 6.1 在 Web 展示 ingest job 状态列表与自动刷新机制
- [x] 6.2 展示失败任务的结构化诊断与 remediation 提示
- [x] 6.3 在提交前后联动 capabilities，提示缺失依赖与降级行为
- [x] 6.4 补充前端交互测试（状态切换、失败回显、重试入口）

## 7. 验证与发布准备

- [x] 7.1 增加端到端验收用例（对话/文本/上传三入口）
- [x] 7.2 验证大文件与批量上传的边界行为（配额、错误提示、部分成功）
- [x] 7.3 更新 README 与 API 文档，说明 Web-first ingest 工作流
- [x] 7.4 执行回归测试，确认搜索、文档浏览、设置页面不回退
