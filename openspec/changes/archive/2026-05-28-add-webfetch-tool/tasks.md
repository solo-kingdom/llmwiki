## 1. 添加依赖

- [x] 1.1 `go get codeberg.org/readeck/go-readability/v2` 添加 readability 正文提取库（原 go-shiori/go-readability 已 deprecated，使用推荐的后继版本）
- [x] 1.2 `go get github.com/JohannesKaufmann/html-to-markdown` 添加 HTML→Markdown 转换库
- [x] 1.3 确认 `go mod tidy` 无问题，两个依赖均为纯 Go（无 CGO）

## 2. 实现 web_fetch 工具核心

- [x] 2.1 新建 `internal/mcp/web_fetch.go`，定义 `webFetchTool` 变量（`Tool` 结构体：名称 `web_fetch`，`urls` 数组参数，描述含使用说明）
- [x] 2.2 实现 `executeWebFetch(workspace string, args map[string]interface{}) (string, error)`：
  - 解析 `urls` 参数（支持 `string` 单 URL 和 `[]interface{}` 多 URL），上限 5 个
  - 逐个调用 `fetchAndExtractURL(workspace, rawURL)` 抓取+提取+持久化
  - 拼接所有结果为 Markdown 文本返回，per-URL 错误隔离（单个失败不影响其他）
- [x] 2.3 实现 `fetchAndExtractURL(workspace, rawURL) (FetchResult, error)`：
  - URL 校验：仅允许 `http://` 和 `https://` scheme
  - HTTP GET：超时 15s，重定向 ≤5 次，响应体 ≤2MB
  - Content-Type 检查：`text/html` 走 readability + html2md，`text/plain` 直接使用，其他返回错误
  - readability 提取：`readability.FromReader(body, parsedURL)` 提取正文
  - html-to-markdown 转换：`mdconv.NewConverter().ConvertString(extractedHTML)`
  - 结果截断：单条 ≤50KB，超出时尾部追加截断标记
- [x] 2.4 实现持久化 `persistFetchResult(workspace, result) (string, error)`：
  - 目标路径 `raw/sources/web-fetch/{domain}/{slug}-{timestamp}.md`
  - 生成 YAML frontmatter（`source_url`、`title`、`fetched_at`、`content_type`）
  - 使用 `os.MkdirAll` + `os.CreateTemp` + `os.Rename` 原子写入模式
  - 返回相对路径用于工具输出

## 3. 注册到工具分发

- [x] 3.1 `internal/mcp/config.go`：新增常量 `DefaultToolWebFetch = "web_fetch"`
- [x] 3.2 `internal/mcp/local_tools.go`：
  - `ExecuteLocalReadonlyTool()` switch 新增 `"web_fetch": executeWebFetch(workspace, args)`
  - `BuiltinReadonlyToolDefinitions()` 追加 `webFetchTool`
  - `BuiltinToolDefinitionsForMode()` 所有模式均追加 `webFetchTool`
- [x] 3.3 `internal/ingest/pipeline_tool_executor.go`：
  - `isLocalReadonlyTool()` 新增 `mcp.DefaultToolWebFetch` case

## 4. 测试

- [x] 4.1 新建 `internal/mcp/web_fetch_test.go`：
  - `TestFetchAndExtractURL`：用 `httptest.NewServer` mock 一个返回 HTML 的服务器，验证 readability 提取 + Markdown 转换 + 持久化文件创建
  - `TestFetchAndExtractURLPlainText`：mock `text/plain` 响应，验证直接返回
  - `TestFetchAndExtractURLErrors`：验证不支持的 scheme、HTTP 404、非 HTML Content-Type 的错误处理
  - `TestExecuteWebFetchMultipleURLs`：验证多 URL 批量抓取和 per-URL 错误隔离
  - `TestExecuteWebFetchURLLimit`：验证超过 5 个 URL 时返回错误
- [x] 4.2 运行 `go test ./internal/mcp/... ./internal/ingest/...` 确认全部通过（11 tests PASS）

## 5. 验证

- [x] 5.1 `make build-go` 编译通过
- [ ] 5.2 启动服务，在 Chat 中输入包含 URL 的消息（如"帮我看看这篇文章：https://example.com"），确认 LLM 调用 `web_fetch` 工具并返回提取后的 Markdown 内容
- [ ] 5.3 检查 `raw/sources/web-fetch/` 目录确认文件已正确持久化
- [ ] 5.4 测试多 URL 场景：一次性给 2-3 个 URL，确认批量返回
- [ ] 5.5 测试错误场景：无效 URL、超时 URL，确认 LLM 收到友好的错误信息而非 tool loop 崩溃
