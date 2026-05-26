## 1. 后端：Retry 条件扩展

- [x] 1.1 修改 `internal/store/sqlite/ingest_jobs.go` 中 `RetryIngestJob()`，将状态校验从 `!= "failed"` 改为 `!= "failed" && != "cancelled"`
- [x] 1.2 在 `internal/api/api_test.go` 中新增 retry cancelled job 的测试用例（cancelled job → retry → 新 job 创建成功，parent_job_id 正确）
- [x] 1.3 验证 retry queued/running/succeeded 状态仍返回 400 错误

## 2. 后端：Job Source 文件 API

- [x] 2.1 在 `internal/api/ingest.go` 中新增 `GetJobSource` handler：读取 job 的 `source_path`，拼接 workspace 绝对路径，校验 path traversal（拒绝含 `..` 或越出 workspace 的路径），根据后缀返回文本 JSON 或图片二进制流
- [x] 2.2 在 `internal/server/server.go` 的 ingest jobs 路由组中注册 `GET /{id}/source` 路由
- [x] 2.3 在 `internal/api/api_test.go` 中新增 GetJobSource 测试：文本文件返回 JSON、图片文件返回二进制、job 不存在返回 404、文件不存在返回 404、path traversal 返回 400

## 3. 前端：Jobs 页面去标题 + Restart 按钮

- [x] 3.1 删除 `web/src/components/JobsPage.tsx` 中 `<h1>Ingest Jobs</h1>` 标题行
- [x] 3.2 修改 `web/src/components/JobCard.tsx`：cancelled 状态显示 [Restart] 按钮，调用 `onRetry`（复用 retry API）
- [x] 3.3 更新前端测试 `web/src/ingest.test.tsx`：验证 cancelled job 显示 Restart 按钮

## 4. 前端：Source 文件预览

- [x] 4.1 在 `web/src/lib/api.ts` 中新增 `getSourceContent(id: string)` 函数，调用 `GET /api/v1/ingest/jobs/{id}/source`
- [x] 4.2 在 `web/src/types.ts` 中新增 `SourceContentResponse` 类型（如需要）
- [x] 4.3 创建 `web/src/components/SourcePreviewDialog.tsx`：base-ui Dialog + ReactMarkdown（文本）/ `<img>`（图片），`max-w-3xl` + `max-h-[80vh]` + `overflow-y-auto` 滚动
- [x] 4.4 修改 `web/src/components/JobCard.tsx`：`source_path` 根据后缀判断是否可点击，可点击时显示链接样式，点击触发预览 Dialog
- [x] 4.5 处理加载态（spinner）和错误态（文件未找到提示）

## 5. 集成验证

- [x] 5.1 端到端手动验证：cancelled job Restart 流程完整
- [x] 5.2 端到端手动验证：点击 .md source_path 预览、图片预览、不支持的格式不可点击
- [x] 5.3 运行全量 `go test ./...` 和 `npm test` 确保无回归
