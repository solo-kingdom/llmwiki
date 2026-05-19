# 技术方案

## 技术栈总览

| 层 | 技术 | 原因 |
|----|------|------|
| 后端 | Go 1.22+ | 单二进制、并发模型、HTTP server、交叉编译 |
| 数据库 | SQLite + FTS5 | 无服务依赖，与 Go 进程内运行 |
| SQLite 驱动 | modernc.org/sqlite（优先）或 mattn/go-sqlite3 | 纯 Go 避免 CGO |
| 前端 | React 19 + TypeScript + Vite | 现代化 SPA，构建产物小 |
| UI 框架 | shadcn/ui 或纯 Tailwind + Radix | 组件化，Tree-shakeable |
| MCP | JSON-RPC 2.0 over stdio/SSE | MCP 标准协议 |
| CLI | cobra | Go 生态标准 CLI 框架 |
| HTTP 路由 | chi 或 net/http (Go 1.22+) | 轻量路由，Go 标准库优先 |
| 文件监视 | fsnotify | Go 生态最成熟的跨平台文件监视 |
| LLM 客户端 | 自建 HTTP streaming client | OpenAI/Anthropic 兼容 SSE 协议 |

---

## 项目结构

```
llmwiki/
├── cmd/
│   └── llmwiki/
│       └── main.go              # 二进制入口
├── internal/
│   ├── server/
│   │   ├── server.go            # HTTP server 组装
│   │   ├── middleware.go         # CORS, auth, logging
│   │   └── routes.go            # API 路由注册
│   ├── api/
│   │   ├── handler/
│   │   │   ├── health.go
│   │   │   ├── documents.go
│   │   │   ├── search.go
│   │   │   ├── ingest.go
│   │   │   └── graph.go
│   │   └── middleware/
│   │       └── auth.go
│   ├── mcp/
│   │   ├── server.go            # MCP JSON-RPC 服务
│   │   ├── transport.go         # stdio / SSE transport
│   │   └── tools/
│   │       ├── guide.go
│   │       ├── search.go
│   │       ├── read.go
│   │       ├── write.go
│   │       └── delete.go
│   ├── store/
│   │   ├── sqlite/
│   │   │   ├── db.go            # 连接管理
│   │   │   ├── documents.go     # documents CRUD
│   │   │   ├── chunks.go        # 分块存储 + FTS
│   │   │   ├── references.go    # 引用图
│   │   │   └── migrations.go    # schema 管理
│   │   └── schema.sql           # DDL（嵌入）
│   ├── engine/
│   │   ├── chunker.go           # 文本分块
│   │   ├── references.go        # 引用解析器
│   │   ├── staleness.go         # 陈旧性传播
│   │   ├── frontmatter.go       # YAML frontmatter 解析
│   │   └── reindex.go           # 重索引逻辑
│   ├── watcher/
│   │   └── watcher.go           # 文件监视器
│   ├── llm/
│   │   ├── client.go            # LLM HTTP streaming client
│   │   └── providers/
│   │       ├── openai.go
│   │       └── anthropic.go
│   └── ingest/
│       ├── pipeline.go          # 两步骤摄取编排
│       ├── cache.go             # SHA256 增量缓存
│       └── merge.go             # 页面合并保护
├── web/
│   ├── src/                     # React 源码
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── docs/                        # 本文档目录
├── openspec/                    # OpenSpec 管理
│   ├── config.yaml
│   ├── changes/
│   └── specs/
├── Makefile
└── README.md
```

---

## HTTP API 设计

### 基础端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/workspace` | 工作区信息 |
| POST | `/api/v1/reindex` | 触发重索引 |

### 文档端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/documents` | 列出文档（支持 `?path=` 和 `?tags=` 过滤） |
| GET | `/api/v1/documents/:id` | 获取文档 |
| GET | `/api/v1/documents/:id/content` | 获取文档全文 |
| POST | `/api/v1/documents` | 创建文档（note） |
| PUT | `/api/v1/documents/:id/content` | 更新文档内容 |
| PATCH | `/api/v1/documents/:id` | 更新元数据 |
| DELETE | `/api/v1/documents/:id` | 删除文档 |
| POST | `/api/v1/documents/bulk-delete` | 批量删除 |

### 搜索端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/search` | 搜索（支持 `?q=&mode=&path=&limit=`） |

### 摄取端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/v1/ingest` | 触发单个源文件摄取 |
| GET | `/api/v1/ingest/status/:id` | 查看摄取状态 |

### 引用图端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/graph/backlinks/:id` | 反向链接 |
| GET | `/api/v1/graph/forward/:id` | 正向引用 |
| GET | `/api/v1/graph/uncited` | 未引用源文件 |
| GET | `/api/v1/graph/stale` | 陈旧页面 |

---

## CLI 设计

```
llmwiki                       # 打印帮助
llmwiki serve [dir]           # 启动服务 (HTTP + MCP)
llmwiki init <dir>            # 初始化工作区
llmwiki reindex <dir>         # 重建索引
llmwiki mcp [dir]             # 运行 stdio MCP server
llmwiki mcp-config [dir]      # 打印 MCP 配置 JSON
llmwiki ingest <file>         # 触发摄取
llmwiki version               # 打印版本
```

### 参数

```
llmwiki serve
  --port 8868                  # HTTP 端口
  --bind 0.0.0.0              # 绑定地址
  --token <secret>             # API token (可选)
  --no-mcp                     # 禁用 MCP
  --no-watch                   # 禁用文件监视
```

---

## MCP 工具设计（5 个工具）

### Guide
```json
{
  "name": "guide",
  "description": "Get started with LLM Wiki. Returns architecture overview and workspace list.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### Search

三种模式：
- `list`: 浏览文件和文件夹（path glob 匹配）
- `search`: 关键词全文搜索（FTS5）
- `references`: 引用图查询（backlinks, forward, uncited, stale）

```json
{
  "name": "search",
  "description": "Browse or search. Modes: list, search, references.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": { "type": "string", "enum": ["list", "search", "references"], "default": "list" },
      "query": { "type": "string", "default": "" },
      "path": { "type": "string", "default": "*" },
      "tags": { "type": "array", "items": { "type": "string" } },
      "limit": { "type": "integer", "default": 10 }
    },
    "required": []
  }
}
```

### Read

按文件类型差异化读取：
- Markdown/文本：直接返回 + highlights + backlinks
- PDF/Office：按页读取，支持 `pages="1-10,15,20-30"`
- 电子表格：先显示 Sheet 列表，再按页读取
- 图片：Base64 编码
- 批量 glob：预算控制（120K 字符）

### Write

三种操作：
- `create`：新建页面/笔记/资源（SVG, CSV）
- `edit`：精确替换 `str_replace`（单次匹配校验）
- `append`：尾部追加

### Delete

按路径或 glob 删除文档。保护 overview.md 和 log.md。

---

## 两步骤摄取 Pipeline

```
源文件 → SHA256 检查
    │
    ├─ 命中缓存 → 跳过 LLM，返回上次结果
    │
    └─ 未命中 →
        Step 1: Analysis
          - 系统提示: buildAnalysisPrompt(purpose, index, truncatedContent)
          - 用户消息: 源文本 + 文件名 + 文件夹上下文
          - LLM: temperature=0.1, max_tokens=4096
          - 输出: 结构化分析（实体、概念、论点、连接、矛盾、建议）
        
        Step 2: Generation
          - 系统提示: buildGenerationPrompt(schema, purpose, index, overview)
          - 用户消息: 源文本 + 分析（上下文）+ "产出 FILE 块，无前言"
          - LLM: temperature=0.1, max_tokens=8192
          - 输出: ---FILE:path content ---END FILE--- 块
        
        Step 3: Write Files
          - 解析 FILE 块 → 安全路径检查
          - 合并逻辑: 数组联合 / 正文 LLM merge / 锁定字段保护
          - 写入文件系统 → 更新 DB → 引用图同步 → 陈旧标记
        
        Step 4: Cache Save
          - 零硬失败 → 保存 SHA256 缓存
```

---

## LLM 调用架构

```go
type LLMClient interface {
    StreamChat(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error)
}

type ChatRequest struct {
    Model       string
    Messages    []Message
    Temperature float64
    MaxTokens   int
    Stream      bool
}

type StreamEvent struct {
    Type    string // "token", "done", "error"
    Content string // token 文本
    Error   error
}

type Message struct {
    Role    string // "system", "user", "assistant"
    Content string
}
```

**超时策略**：
- HTTP 请求超时：30 分钟（大上下文推理模型）
- 连接超时：30 秒
- 首字节超时：120 秒
- 流式读取空闲超时：60 秒

**提供商适配**：
- OpenAI: `https://api.openai.com/v1/chat/completions`
- Anthropic: `https://api.anthropic.com/v1/messages`
- Ollama: `http://localhost:11434/api/chat`
- Custom: 任意 OpenAI 兼容端点

---

## 文件监视器设计

```go
type FileWatcher struct {
    watcher    *fsnotify.Watcher
    workspace  string
    written    map[string]time.Time
    cooldown   time.Duration      // 4s
    debounce   time.Duration      // 700ms
    mu         sync.Mutex
    ignoreDirs map[string]bool    // .llmwiki, .git, node_modules, ...
    done       chan struct{}
}

func NewFileWatcher(workspace string, handler ChangeHandler) *FileWatcher

func (fw *FileWatcher) MarkWritten(path string)
func (fw *FileWatcher) Start() error
func (fw *FileWatcher) Stop()
```

变更处理流程：
```
fsnotify event → 路径过滤 → 防抖收集 (BTreeSet, 700ms)
    → SHA256 hash 检测 → 仅实际变更的路径
    → ChangeHandler(path, ChangeType{Create|Modify|Delete})
        → 创建: 索引新文件 + 提取文本
        → 修改: 重新索引 + 重新分块
        → 删除: 归档 DB 记录 + 级联清理
```

---

## 前端构建与嵌入

```
开发: cd web && npm run dev  (独立运行在 localhost:5173，proxy API 到 :8868)
构建: cd web && npm run build (产出 dist/)
嵌入: go build -tags embed (将 dist/ 打包进二进制)
```

Go server 的路由：
```go
// 静态文件服务
mux.Handle("/assets/", http.FileServer(http.FS(webAssets)))

// SPA fallback
mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    if !strings.HasPrefix(r.URL.Path, "/api/") {
        r.URL.Path = "/"
    }
    http.FileServer(http.FS(webAssets)).ServeHTTP(w, r)
})
```

---

## 远程服务场景

```
┌─────────────────────┐         ┌─────────────────────┐
│   开发机 (源文件)     │         │   远程浏览器 / CLI    │
│                     │         │                     │
│  ~/research/        │   HTTP  │  http://host:8868   │
│  ├── wiki/          │ ◀──────▶│  Web UI             │
│  └── raw/           │         │                     │
│                     │         │  llmwiki --remote   │
│  llmwiki serve      │         │  host:8868 ingest   │
│  --bind 0.0.0.0     │         │                     │
└─────────────────────┘         └─────────────────────┘
```

远程 CLI 通过 HTTP API 交互，必要时可增加 `llmwiki --remote <host>` 模式。
