## Why

当前 Web 工作台在最近一次 Wiki reader 分离与 Ingest Chat 重排后出现多处回归：点击 Wiki 入口时页面一闪而过又回到 Ingest，Ingest 页面宽度与 Jobs/Settings 不一致，切换/新建会话入口仍停留在输入框上方，底部按钮的主次关系不清晰。与此同时，聊天回复失败时只显示笼统的失败文案或 `Error in input stream`，没有错误原因、日志线索、重新发送入口，也缺少消息复制能力，导致用户难以恢复失败对话。

另一个独立但同源的问题出现在 `session_archive` 分析任务：日志显示 `send request: Post "/chat/completions": unsupported protocol scheme ""`。这说明归档/分析链路在构造 LLM client 时可能拿到了空 `base_url`，却仍继续向相对路径发起请求。该错误最终被包装为 “the LLM pipeline encountered an error; check logs for details”，前端和任务详情都没有给出可操作的配置提示。

## What Changes

- 修复 Wiki reader 入口回归，确保从工作台点击 Wiki 后稳定停留在 `/wiki`，且私有/公开 Wiki 模式下都有清晰的加载或错误状态。
- 重排 Ingest Chat 输入区按钮：输入框下方左侧为 `切换`、`新建`、`模型`、`归档`，右侧为 `附件`、`发送`。
- 统一 Ingest 页面宽度与其他管理页面的内容容器策略，避免 Ingest 视觉上比 Jobs/Settings 明显窄。
- 为聊天消息增加复制能力；失败回复增加重新发送入口，并保留用户原始输入以便恢复。
- 改善 stream 错误处理：实时 token 回显保持可见，SSE/LLM 错误要展示具体原因，并写入服务端日志。
- 修复长回复流被短超时中断的问题，避免正常 LLM stream 被全局 HTTP timeout/write timeout 提前切断。
- 修复 `session_archive` LLM 配置校验：当 provider instance 或 base URL 缺失时，失败信息应指向模型配置问题，而不是继续请求 `"/chat/completions"`。

## Capabilities

### Modified Capabilities

- `web-app-shell`: Wiki reader 与工作台入口导航稳定性修复。
- `ingest-chat-ui`: Ingest Chat 输入区布局、消息操作、错误状态和页面宽度修复。
- `ingest-session-api`: 会话消息 stream 错误事件、失败重发所需的前端数据流与后端错误表达修复。
- `llm-integration`: LLM client 配置校验与错误分类增强，覆盖归档分析任务与会话 stream。
- `ingest-pipeline`: `session_archive` 失败原因应包含可操作的 provider/base URL 配置提示。

## Impact

- **前端路由与壳层**: `web/src/App.tsx`、`web/src/lib/wiki-routes.ts`、`web/src/components/WorkbenchLayout.tsx`、`web/src/context/WikiReaderContext.tsx`
- **Ingest Chat UI**: `web/src/components/IngestChat.tsx`、`web/src/components/SessionControls.tsx`、`web/src/context/AppContext.tsx`、`web/src/types.ts`
- **前端 API/stream**: `web/src/lib/api.ts`、相关 Vitest 测试
- **后端 stream/API**: `internal/api/ingest_session.go`、`internal/server/server.go`
- **LLM 配置与归档链路**: `internal/llm/client.go`、`internal/api` / `internal/ingest` 中创建归档分析任务和 LLM client 的代码路径
- **测试**: 前端布局与错误交互测试，后端 stream/error/config 校验测试，必要的归档失败用例
