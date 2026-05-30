## Context

`ExecuteLocalReadonlyTool`（`internal/mcp/local_tools.go`）是所有内建工具的统一分发入口，签名 `(workspace string, db *sqlite.DB, name string, args map[string]interface{}) (string, error)`。现有工具按名称分发到 `executeLocal*` 函数。每个工具的定义是一个包级 `Tool` 变量，通过 `BuiltinToolDefinitionsForMode()` 注册到对应模式。

现有的 `isLocalReadonlyTool()`（`internal/ingest/pipeline_tool_executor.go`）在 pipeline 中判断工具是否走本地执行——当前只识别 `search` 和 `read`。

源文件持久化遵循统一模式（`internal/ingest/normalize.go`）：`raw/sources/web-ingest/{slug}-{timestamp}.md`，使用原子写入（`internal/api/filewrite.go` 的 `writeFileBytesFirst` 模式：先写临时文件再 rename）。

项目使用 Go 标准库 `net/http.Client`，已有超时和重试模式（`internal/llm/provider_sync.go`）。

## Goals / Non-Goals

**Goals:**

- LLM 可通过 `web_fetch` 工具抓取指定 URL 的网页内容
- 使用 readability 算法提取正文（去除导航、侧边栏、广告等噪音）
- 输出 Markdown 格式，与 wiki 页面格式一致
- 抓取内容自动持久化到 `raw/sources/web-fetch/`，保持文件即真理
- 支持单次调用传入多个 URL（数组参数），返回所有结果
- 所有会话模式（default、qa、organize）和 ingest pipeline 均可用

**Non-Goals:**

- 不做网络搜索（需要第三方 API，属于外部 MCP 服务范畴）
- 不做需要认证的抓取（无 Cookie/Header 注入）
- 不做 JavaScript 渲染（无 headless browser）
- 不做 PDF/Office 等非 HTML 内容的抓取（已有 tiered processing 覆盖）
- 不修改现有的对话归档流程（抓取内容通过 LLM 整合后走正常 archive）

## Decisions

### 1. 工具接口设计：支持多 URL

**选择**：`web_fetch` 接受 `urls` 数组参数（必填），返回所有 URL 的抓取结果。

```json
{
  "name": "web_fetch",
  "parameters": {
    "urls": ["https://example.com/article1", "https://example.com/article2"]
  }
}
```

返回格式：
```
## https://example.com/article1
> Title: Article One
> Fetched: 2026-05-28T14:30:00+08:00
> Saved: raw/sources/web-fetch/example.com/article-one-20260528-143000.md

[Markdown 正文]

---

## https://example.com/article2
> Title: Article Two
...

---
```

**备选 A**：每次只接受单个 URL。多 URL 由 LLM 在 tool loop 中多次调用。**否决**——增加不必要的 tool loop 轮次，浪费 token。单次调用多 URL 更高效。

**限制**：单次最多 5 个 URL，防止滥用。

### 2. 内容处理管线

**选择**：HTTP GET → Content-Type 检查 → readability 提取 → html-to-markdown 转换 → 截断

```
URL 输入
  │
  ▼
HTTP GET (超时 15s, 重定向 ≤5 次)
  │
  ▼
Content-Type 检查
  ├── text/html → 继续
  ├── text/plain → 直接返回
  └── 其他 → 返回错误 "unsupported content type: ..."
  │
  ▼
readability.Parse() → 提取正文 DOM
  │
  ▼
html-to-markdown.Convert() → Markdown
  │
  ▼
截断（单条结果 ≤ 50KB，总计 ≤ 200KB）
  │
  ▼
返回给 LLM
```

**备选 A**：仅做 `strings.ReplaceAll` 去 HTML 标签。**否决**——输出是粗糙的纯文本，丢失标题/列表/链接等语义结构。

**备选 B**：不做 readability，直接转整个页面。**否决**——导航栏、侧边栏、广告等噪音严重，浪费 LLM 上下文窗口。

### 3. 持久化策略

**选择**：每次抓取自动保存到 `raw/sources/web-fetch/{domain}/{slug}-{timestamp}.md`

```
raw/sources/
├── web-ingest/          ← 已有：对话/文本/上传来源
├── web-fetch/           ← 新增
│   ├── example.com/
│   │   ├── article-one-20260528-143000.md
│   │   └── another-post-20260528-143100.md
│   └── docs.python.org/
│       └── tutorial-20260528-150000.md
```

文件头部包含 YAML frontmatter：
```yaml
---
source_url: https://example.com/article1
title: Article One
fetched_at: 2026-05-28T14:30:00+08:00
content_type: text/html
---
```

**选择理由**：
- 保持"文件是真理之源"原则——抓取内容有据可查
- 按域名分目录，避免单目录文件过多
- timestamp 保证不冲突，同 URL 重复抓取会产生新文件（不做去重，简单可靠）

**备选 A**：不持久化，仅临时返回。**否决**——用户明确要求保存，且与项目"文件即真理"的核心理念冲突。

**备选 B**：统一保存在 `raw/sources/web-ingest/`。**否决**——`web-ingest` 是 Web UI 提交的来源，`web-fetch` 是 LLM 主动抓取，语义不同。

### 4. 依赖选择

| 依赖 | 用途 | 选择理由 |
|------|------|---------|
| `github.com/go-shiori/go-readability` | readability 正文提取 | 成熟、可移植纯 Go、基于 Mozilla readability |
| `github.com/JohannesKaufmann/html-to-markdown` | HTML → Markdown | 高质量转换、保留语义结构、活跃维护 |

两个库均为纯 Go 实现，无 CGO 依赖，与项目 `modernc.org/sqlite` 的无 CGO 策略一致。

### 5. 安全边界

| 约束 | 值 | 理由 |
|------|---|------|
| 协议限制 | 仅 `http://`、`https://` | 防止 SSRF（`file://`、`ftp://` 等） |
| 请求超时 | 15 秒 | 平衡用户体验和资源占用 |
| 响应体上限 | 2MB | 防止内存爆炸 |
| 重定向上限 | 5 次 | 防止重定向循环 |
| 单次 URL 上限 | 5 个 | 防止单次调用时间过长 |
| 单条结果上限 | 50KB Markdown | 限制 LLM 上下文消耗 |
| 总结果上限 | 200KB | 单次工具调用的总输出上限 |
| 并发抓取 | 顺序执行 | 简单可靠，5 个 URL 最多 75 秒 |

### 6. 工具注册位置

- **工具定义和实现**：新文件 `internal/mcp/web_fetch.go`
- **分发注册**：`ExecuteLocalReadonlyTool()` 新增 `"web_fetch"` case
- **模式注册**：`BuiltinToolDefinitionsForMode()` 所有模式均包含 `webFetchTool`
- **Pipeline 注册**：`BuiltinReadonlyToolDefinitions()` 包含 `webFetchTool`
- **Pipeline 识别**：`isLocalReadonlyTool()` 新增 `"web_fetch"` case
- **工具名常量**：`internal/mcp/config.go` 新增 `DefaultToolWebFetch = "web_fetch"`

### 7. 错误处理

- URL 格式错误：返回友好错误文本（不中断 tool loop）
- HTTP 错误（4xx/5xx）：返回 `"HTTP 404: Not Found"` 形式的文本
- 超时：返回 `"fetch timeout after 15s"`
- 不支持的 Content-Type：返回 `"unsupported content type: application/pdf"`
- readability 提取失败：fallback 到全页面 HTML→Markdown（含噪音但总比没有好）
- 单个 URL 失败不影响其他 URL 的结果（per-URL 错误隔离）

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| readability 提取质量因网站而异 | fallback 到全页面转换；工具描述中引导 LLM 告知用户结果可能不完整 |
| 大量抓取消耗服务器带宽和内存 | 单次 5 URL 限制 + 2MB 响应上限 + 15s 超时 |
| 抓取的网页内容可能包含敏感信息 | 与手动粘贴等效，用户主动提供 URL 即授权 |
| `go-readability` 对某些现代 SPA 页面无法提取 | Non-goal：不做 JS 渲染，工具返回错误提示用户手动复制 |
| 持久化文件可能过期（网页内容已更新） | 文件名含 timestamp，不承诺时效性；与所有 raw/ 源文件一致 |
| 新增两个外部依赖 | 两个库均为纯 Go、活跃维护、无 CGO |

## Migration Plan

1. `go get` 添加两个依赖
2. 新建 `internal/mcp/web_fetch.go`
3. 修改 `local_tools.go` 和 `pipeline_tool_executor.go`
4. 运行测试确认无回归
5. 无数据迁移、无配置变更、无 UI 变更

## Open Questions

（无 — 用户在探索阶段已明确所有关键决策）
