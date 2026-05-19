# 架构决策记录

## 项目定位

**llmwiki**：一个基于 Go 的二进制工具，用于基于大模型整理 Wiki，具备远程服务能力。

### 三元入口

```
                    ┌─────────────────────────────────────┐
                    │        llmwiki (Go 单二进制)          │
                    │        ./llmwiki serve               │
                    ├─────────────────────────────────────┤
                    │  ┌──────────┐ ┌──────────┐ ┌──────┐ │
                    │  │ MCP/SSE  │ │ HTTP API │ │ CLI  │ │
                    │  │ (stdio)  │ │ (REST)   │ │(cobra)│ │
                    │  ├──────────┤ ├──────────┤ ├──────┤ │
                    │  │ 给 LLM   │ │给 Web UI │ │给人  │ │
                    │  │          │ │+ 远程服务│ │/LLM  │ │
                    │  └────┬─────┘ └────┬─────┘ └──┬───┘ │
                    │       └──────┬─────┴──────────┘     │
                    │         Core Service                │
                    │   摄取引擎 · 搜索 · 引用图 · 监视     │
                    │         SQLite + Filesystem         │
                    │   Embedded React/Vite/TS Web UI     │
                    └─────────────────────────────────────┘
```

### 角色映射

| 入口 | 使用者 | 场景 |
|------|--------|------|
| MCP (stdio) | Claude/Codex Agent | Agent 通过对话管理 Wiki |
| HTTP API (:8868) | Web UI + 远程客户端 | 人在浏览器中操作；跨设备访问 |
| CLI (cobra) | 人 + LLM | `llmwiki init ~/research`；被脚本调用 |

---

## 决策 1: Go 单二进制

### 选择：Go 后端 + embed Web 前端

**理由**：
- 部署简单：一个二进制文件，无需 Python 环境、Node.js 运行时
- 远程服务：自然的 HTTP server，支持跨设备访问
- 性能：Go 的并发模型适合文件监视器 + HTTP server + MCP stdio 多组件同时运行
- 交叉编译：`GOOS=linux GOARCH=amd64 go build` 生成各个平台二进制

**与参考实现的对比**：
- lcasastorian: Python + Node.js → 3 个进程，部署同步麻烦
- nashsu: Tauri (Rust) → 桌面应用，不适合远程服务

### 嵌入 Web UI 方案
Go 1.16 `embed.FS` 直接打包 `dist/` 产物：
```go
//go:embed web/dist/*
var webAssets embed.FS
```
需处理 SPA 路由：所有非 `/api` 路径回退到 `index.html`。

---

## 决策 2: 文件即真理，SQLite 仅作索引

### 原则
> 所有用户数据以明文存储在文件中，SQLite 仅用于提升搜索和查询性能。删库后可从文件系统完全重建。

### 数据分类

| 类别 | 存储位置 | 删库可恢复 | 备注 |
|------|----------|:---:|------|
| Wiki 页面正文 | `wiki/*.md` | ✅ | 文件即真理 |
| YAML frontmatter (tags, date, description) | 文件 YAML 中 | ✅ | reindex 时需解析回填 |
| 引用图 (cites + links_to) | SQLite document_references | ✅ | 从 wiki 页面的脚注重新解析 |
| 源文件 | `raw/sources/*` | ✅ | 不可变 |
| PDF 提取文本 + 分块 | SQLite document_pages + chunks | ⚠️ | 需重新提取，质量可能波动 |
| 用户高亮/批注 | 文件中或独立文件 | ✅ | 必须文件化，不能 DB-only |
| FTS5 索引 | SQLite chunks_fts | ✅ | 纯衍生，自动重建 |
| 陈旧标记/版本号 | SQLite | ❌ | 无业务意义，丢失不影响 |

### 与 lcasastorian 的关键差异
lcasastorian 的 `reindex` **不回填 frontmatter**（tags 写死 `[]`）且**不重建引用图**。我们的实现必须在 reindex 时：
1. 解析每个 `.md` 的 YAML frontmatter → 回填 tags, date, description
2. 重新解析所有 wiki 页面的脚注和 wikilink → 重建 document_references
3. 对所有文本文件重新分块 → 重建 document_chunks + FTS5

---

## 决策 3: Go 服务内置 LLM 调用能力

### 选择：内置 OpenAI/Anthropic 兼容的 LLM 客户端

**理由**：
- Web UI 和 CLI 场景需要触发摄取，不能要求用户先连接 MCP
- 远程服务场景下，前端不应代理 LLM API key
- 两步骤摄取（分析→生成）需要在服务端编排

**实现**：Go 内建 streaming HTTP client，支持 SSE 解析：
```go
type LLMClient interface {
    StreamChat(ctx context.Context, req ChatRequest) (<-chan StreamEvent, error)
}
type ChatRequest struct {
    Model       string
    Messages    []Message
    Temperature float64
    MaxTokens   int
}
```

---

## 决策 4: 搜索引擎用 SQLite FTS5

### 选择：SQLite FTS5（Porter stemming）

**理由**：
- 与 SQLite 元数据库在同一进程中，无额外依赖
- lcasastorian 已验证 FTS5 在中等规模（~100 源，~数百页）时效果良好
- 不需要 CGO（用 `modernc.org/sqlite` 纯 Go 实现）

**可选增强**（后期）：引入 Bleve 做混合搜索（关键词 + 向量），或者等 Go 生态出现 LanceDB 客户端。

### 搜索流水线设计

```
查询
  ↓
SQLite FTS5 (关键词，BM25 rank)
  ↓
结果：chunk + page + header_breadcrumb + score
  ↓
120 字符上下文片段高亮
```

---

## 决策 5: Wiki 文件结构

### 选择：继承 Karpathy 标准 + 引入 purpose.md

```
~/research/
├── purpose.md              ← 目标、关键问题、研究范围（来自 nashsu）
├── schema.md               ← 结构约定（如果引入）
├── raw/
│   ├── sources/            ← 源文件（不可变）
│   └── assets/             ← 本地图片
├── wiki/
│   ├── overview.md         ← 全局总览（自动维护）
│   ├── log.md              ← 操作日志（仅追加，带时间前缀）
│   ├── index.md            ← 内容目录（按类别）
│   ├── entities/           ← 实体页面
│   ├── concepts/           ← 概念页面
│   ├── sources/            ← 源文件摘要
│   ├── queries/            ← 查询结果归档
│   ├── synthesis/          ← 综合分析
│   └── comparisons/        ← 对比分析
└── .llmwiki/
    ├── index.db            ← SQLite 索引
    └── cache/              ← 衍生缓存（PDF 转换等）
```

### overview.md 和 log.md 受保护
MCP 工具的 delete 操作拒绝删除这两个文件，只能通过 edit 修改。

---

## 决策 6: MCP 协议实现

### JSON-RPC 2.0 over stdin/stdout

```
Client (Claude/Cursor) → stdin → Server → stdout → Client

核心方法:
  initialize      → 返回 serverInfo + capabilities
  tools/list      → 返回所有工具的 name + description + inputSchema
  tools/call      → 解析 params.arguments，分发到 handler

工具集 (初步):
  guide           → 返回使用指南 + 工作区列表
  search          → 三种模式: list / search / references
  read            → 按类型读取文档
  write           → create / edit (str_replace) / append
  delete          → 按路径/glob 删除
```

Go 实现：`bufio.Scanner` 从 stdin 读行 → `json.Decoder` 解析 JSON-RPC → 分发 → `json.Encoder` 写 stdout。stderr 用于日志。

---

## 决策 7: 文件监视器设计

### 选择：Go fsnotify + 自写保护

参考 nashsu 的 Rust 实现和 lcasastorian 的 Python 实现：

```go
type FileWatcher struct {
    watcher  *fsnotify.Watcher
    written  map[string]time.Time   // 自写路径 + 时间戳
    cooldown time.Duration          // 4 秒冷却
    mu       sync.Mutex
}

func (fw *FileWatcher) MarkWritten(path string) { ... }
func (fw *FileWatcher) shouldIgnore(path string) bool { ... }
```

防抖批处理：700ms 内收集所有变更路径 → 批量处理。忽略 `.llmwiki/`、`.git/`、`node_modules/` 等目录。

---

## 决策 8: 前端 UI 框架选择

### 选择：Vanilla React 19 + 轻量组件

**候选 UI 框架**：
- shadcn/ui (nashsu 使用的，Radix + Tailwind)
- Ant Design
- Material UI (MUI)
- Chakra UI
- 纯 Tailwind + Headless UI

**待定**，需评估孰适合 Go embed 打包（体积、构建速度）。倾向于 shadcn/ui 或纯 Tailwind + Radix 组件。

---

## 决策 9: 远程服务架构

### 选择：HTTP REST API + 可选 Token 认证

```
llmwiki serve --port 8868 --bind 0.0.0.0

远程客户端:
  Web UI     → http://host:8868/  (embed 的 SPA)
  API 调用   → http://host:8868/api/v1/...
  MCP 代理?  → http://host:8868/mcp (SSE 模式)
```

token 保护可选（类似 nashsu 的 `--token` 参数）。本地 `127.0.0.1` 默认无需认证。

---

## 未决问题

1. **Go 的 SQLite 驱动**：`modernc.org/sqlite` vs `mattn/go-sqlite3`（CGO 问题）
2. **前端路由**：SPA 的 client-side routing 需要 Go server 把所有非 API 路径 fallback 到 index.html
3. **MCP SSE 模式**：远程场景下 MCP 需要用 SSE 而非 stdio，是否在首个版本支持？
4. **LLM 调用的并发安全**：两步骤摄取 + 文件操作在一个请求中，需要事务或锁
5. **源文件处理**：PDF/Office 提取是否内建到 Go 二进制？还是依赖外部工具？
