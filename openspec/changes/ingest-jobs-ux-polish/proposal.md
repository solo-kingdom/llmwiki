## Why

Jobs 页面有几个体验问题影响日常使用：页面标题"Ingest Jobs"占用空间且无信息增量；cancelled 和 failed 的 job 无法便捷恢复操作；用户无法预览 job 关联的原始文件内容（尤其是 session archive 生成的 markdown），需要跳转到文件管理器才能查看。

## What Changes

- 移除 Jobs 页面顶部的 "Ingest Jobs" 标题
- cancelled 状态的 job 增加 [Restart] 按钮，后端扩展 retry 接口允许 cancelled 状态走 retry 路径（创建新 job，保持 lineage 链）
- Job 卡片的 `source_path` 变为可点击链接，支持 `.md`、`.txt`、图片格式（`.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.svg`）的文件预览
- 新增后端 API `GET /api/v1/ingest/jobs/{id}/source` 返回 job 关联的源文件内容
- 预览使用模态框（Dialog），内容区域 max-height + 滚动，markdown 用 ReactMarkdown 渲染，图片直接展示

## Capabilities

### New Capabilities
- `job-source-preview`: Job 源文件预览——点击 job 卡片的 source_path 在模态框中预览关联的原始文件内容

### Modified Capabilities
- `jobs-page-ui`: 取消页面标题；cancelled 状态增加 Restart 按钮；source_path 可点击触发预览
- `ingest-api`: 扩展 retry 接口支持 cancelled 状态；新增 job source 文件读取端点

## Impact

- **前端**: `JobsPage.tsx`（删标题）、`JobCard.tsx`（Restart 按钮 + 可点击 source_path + 预览 Dialog）、`api.ts`（新增 `getSourceContent`）
- **后端**: `internal/api/ingest.go`（新增 `GetJobSource` handler、`RetryIngestJob` 放宽条件）、`internal/server/server.go`（注册新路由）
- **测试**: `api_test.go`（retry cancelled job 测试、source 预览测试）、前端测试适配
