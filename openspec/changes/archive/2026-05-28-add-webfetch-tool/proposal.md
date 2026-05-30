## Why

当前 LLM 在对话中只能操作本地 wiki 内容（search、read、references 等工具），无法获取任何外部信息。用户在对话中提到一个 URL 时，必须手动复制网页内容粘贴到聊天中，体验割裂。LLM 缺少"主动抓取网页内容"的能力，这是知识工作流中的一个明显缺口。

## What Changes

- 新增内建工具 `web_fetch`：接收 URL，抓取网页内容，使用 readability 算法提取正文，转换为 Markdown 格式返回给 LLM
- 抓取的内容自动保存到 `raw/sources/web-fetch/` 目录，保持"文件是真理之源"的一致性
- 支持单次传入多个 URL（批量抓取），每次调用返回结构化结果
- 所有三个会话模式（default/ingest、qa、organize）均可用
- ingest pipeline 同样可用

## Capabilities

### New Capabilities

- `web-fetch-tool`：内建 URL 抓取工具，readability 提取 + Markdown 转换 + 自动持久化

### Modified Capabilities

- `llm-integration`：`ExecuteLocalReadonlyTool` 新增 `web_fetch` 分发；`BuiltinToolDefinitionsForMode` 和 `BuiltinReadonlyToolDefinitions` 注册新工具
- `ingest-pipeline`：pipeline tool executor 的 `isLocalReadonlyTool` 识别 `web_fetch`

## Impact

- **Go 依赖**: 新增 `github.com/JohannesKaufmann/html-to-markdown`（HTML→Markdown）、`github.com/go-shiori/go-readability`（正文提取）
- **新增文件**: `internal/mcp/web_fetch.go`（工具定义 + 实现）
- **修改文件**: `internal/mcp/local_tools.go`（注册分发）、`internal/ingest/pipeline_tool_executor.go`（pipeline 识别）
- **磁盘**: `raw/sources/web-fetch/{domain}/{slug}-{timestamp}.md` 持久化抓取内容
- **安全**: 仅允许 HTTP/HTTPS 协议，请求超时 15s，响应体大小限制 2MB，重定向上限 5 次
- **兼容性**: 纯增量变更，不影响现有工具行为
