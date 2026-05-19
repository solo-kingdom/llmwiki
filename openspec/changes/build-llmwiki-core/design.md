## Context

本项目基于 Andrej Karpathy 的 [LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，参考了两个已有实现（lcasastorian/llmwiki 和 nashsu/llm_wiki）的架构和数据模型。目标是创建一个 Go 单二进制工具，同时支持 MCP（给 LLM Agent）、HTTP API/Web UI（给人）、CLI（给人/LLM）三种交互入口，并具备远程服务能力。

**约束**：
- 所有用户数据以明文存储在文件中（Markdown + YAML frontmatter），SQLite 仅做搜索索引
- 单二进制部署（Go 后端 + 内嵌 React 前端），支持远程服务和本地模式
- 删除 SQLite 后可从文件系统完全重建索引和数据
- 支持 OpenAI/Anthropic 兼容的 LLM API（内置 streaming client）

## Goals / Non-Goals

**Goals:**
1. 实现 Karpathy LLM Wiki 的核心功能：三层入口、两步骤摄取、引用图、全文搜索、文件监视
2. 文件即真理的存储架构：删 DB 可无损恢复
3. 单二进制 + 远程服务能力
4. MCP stdio 协议，5 个工具完整可用
5. 嵌入式 Web UI（React/Vite/TypeScript）

**Non-Goals:**
- 首版不支持向量搜索或 LanceDB
- 首版不支持多用户/多租户（单一工作区 + 可选 token）
- 首版不支持知识图谱可视化（Louvain 社区发现等）
- 首版不支持 Deep Research（Web 搜索→自动摄入）
- 首版不支持 Chrome Extension Web Clipper
- 首版不支持 MCP SSE 远程模式（仅 stdio）
- 首版不支持 Git 集成或跨设备同步

## Decisions

### D1: Go 后端架构

**选择**: 单一 Go binary，`chi` 或标准库 `net/http` 做 HTTP 路由，`cobra` 做 CLI，`fsnotify` 做文件监视

**考虑的替代方案**:
- Python (FastAPI): 放弃，不符合"单二进制"目标，部署沉重
- Rust (Tauri): 放弃，桌面 App 定位，不适合远程服务

**理由**: Go 的并发模型天然适合同时运行 HTTP server、文件监视器、MCP stdio server。交叉编译简便。

### D2: SQLite 驱动

**选择**: `modernc.org/sqlite`（纯 Go）为首选，若 FTS5 有问题则切换到 `mattn/go-sqlite3`

**考虑的替代方案**: `mattn/go-sqlite3`（需 CGO）

**理由**: 纯 Go 避免 CGO 交叉编译痛点。`modernc.org/sqlite` 是 SQLite 的 Go 翻译版本，无需 C 工具链。

### D3: 文件即真理的存储架构

**选择**: 所有用户数据以明文 Markdown（含 YAML frontmatter）存储在 `wiki/` 目录，SQLite 仅索引 `documents`、`document_chunks`、`document_references` 等衍生数据

**理由**: 
- 与 Obsidian 兼容，用户可直接用 Obsidian 浏览 Wiki
- 版本控制友好（整个 workspace 就是一个 git repo）
- 删 DB 可重索引恢复，数据不丢失
- lcasastorian 已验证此模式可行，但其 `reindex` 有 gap（不回填 frontmatter），我们修复

### D4: 两步骤摄取 pipeline

**选择**: 分析（Step 1）→ 生成（Step 2）→ 文件写入（Step 3），类似 nashsu/llm_wiki

**理由**: nashsu 验证了两次 LLM 调用比单次调用质量显著更好。分析阶段给 LLM 提供结构化思考空间，生成阶段聚焦文件产出。

### D5: 引用图解析引擎

**选择**: 正则解析脚注 `[^N]: file, p.3` 和 wiki 链接 `[text](path)`，三层 fallback 匹配目标文档

**理由**: lcasastorian 的实现已验证。正则简单可靠，三层匹配覆盖了文件名变体、无扩展名、相对路径等常见场景。`UNIQUE(source, target, type)` 约束避免重复边。

### D6: MCP JSON-RPC 实现

**选择**: 自建轻量 JSON-RPC 2.0 over stdio，支持 `initialize` / `tools/list` / `tools/call` 三个核心方法

**考虑的替代方案**: 使用 Go 的第三方 MCP 库（如 mark3labs/mcp-go）

**理由**: MCP 协议本身简单（JSON-RPC + 几个方法），自建避免外部依赖不稳定。后期可评估第三方库的成熟度。

### D7: 前端 UI 框架

**选择**: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui

**考虑的替代方案**: Ant Design, MUI, 纯 Tailwind + Headless UI

**理由**: shadcn/ui 组件 Tree-shakeable，构建产物小（利于 Go embed），nashsu 已验证此组合。

## Risks / Trade-offs

- **[风险] Go 生态 PDF 提取不成熟** → **缓解**: 首版仅支持 Markdown 和纯文本源，PDF/Office 暂时标记为待处理
- **[风险] FTS5 中文分词效果差** → **缓解**: 接入 CJK bigram 分词（参考 nashsu 的 TypeScript 实现逻辑翻译为 Go），或使用 `unicode61` tokenizer 的 trigram
- **[风险] 引用图全量替换的短暂不一致** → **缓解**: 在 SQLite 事务中执行先删后写，保证原子性
- **[风险] 文件监视器跨平台差异（Linux inotify 丢事件）** → **缓解**: Linux 下 10 秒定期重扫描，macOS/Windows 较可靠
- **[风险] LLM 调用成本（每次摄取 15K+ tokens）** → **缓解**: SHA256 增量缓存，未变文件跳过。temperature=0.1 降低随机性，减少 token 浪费
- **[风险] 嵌入 SPA 的 client-side routing** → **缓解**: Go HTTP handler 把非 `/api/` 路径 fallback 到 `index.html`

## Open Questions

1. `modernc.org/sqlite` 的 FTS5 支持程度？需实际验证
2. 前端构建产物 (dist/) 大小？影响 Go binary 体积
3. LLM streaming client 的超时策略：30 分钟 for reasoning models? 是否需要可配置？
4. 摄取队列：首版用内存队列还是 SQLite-backed job queue？
5. 源文件处理：是否需要引入外部工具 (opendataloader, LibreOffice) 还是首版仅支持文本？
