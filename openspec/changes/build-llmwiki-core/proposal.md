## Why

个人知识管理面临结构性矛盾：源材料（论文、笔记、文章）不断积累，但手动维护交叉引用、保持摘要最新、标记矛盾的工作量随源数量增长而失控。Karpathy 的 LLM Wiki 模式用 LLM 解决"谁来维护"的问题——LLM 作为知识编译器，从源文件中提取和综合知识，自动写入结构化的、互链的 Wiki 页面。目前已有 Python (lcasastorian/llmwiki) 和 Rust/Tauri (nashsu/llm_wiki) 两个参考实现，但没有一个 **Go 单二进制、支持远程服务、同时提供 MCP/Web/CLI 三种交互入口** 的实现。本项目填补这个空白。

## What Changes

- 创建 Go 单二进制 `llmwiki`，内嵌 React/TypeScript Web UI 和 SQLite 索引
- 实现单进程单服务拓扑：`llmwiki serve` 在同一进程内启动 HTTP API + Web UI + MCP RPC + 文件监视 + 后台索引
- 实现三层入口：MCP RPC（HTTP POST JSON-RPC 2.0，给 LLM Agent）、HTTP REST API（给 Web UI + 远程客户端）、CLI（给人/LLM）
- 实现文件即真理的存储哲学：所有用户数据以明文 Markdown 存储，SQLite 仅做可重建衍生索引（chunks、FTS、references），删库后可从文件系统完全重建；DB 可缓存真理数据副本但不可作为权威源
- 实现引用图引擎：自动解析 Wiki 页面中的脚注引用和 wiki 链接，构建知识关系图；更新采用事务 + 幂等 upsert 策略
- 实现两步骤摄取 pipeline：LLM 分析 → LLM 生成 → 文件写入 → 引用图同步；支持跨文件并发、同页面串行（path mutex）
- 实现文件系统监视器：自动感知文件变更并同步索引
- 实现分层源文件处理：首版支持 PDF/Office，采用 tiered capability（内建解析 → 可选系统依赖 → 可观测降级）
- 支持远程服务：`llmwiki serve --bind 0.0.0.0` 暴露 HTTP API + MCP RPC，供跨设备访问
- LLM 配置管理：Web UI 设置页优先，环境变量回退，超时参数可配置

## Capabilities

### New Capabilities

- `workspace-management`: 工作区生命周期管理——初始化、索引、重索引、文件监视。管理 `wiki/`、`raw/sources/`、`.llmwiki/` 目录结构。
- `document-store`: 文档 CRUD——创建、读取、更新、删除 Wiki 页面和源文件。文件名 slugify、frontmatter 解析、路径安全校验。
- `search-engine`: 全文搜索——基于 SQLite FTS5 的分块搜索，BM25 排序，120 字符上下文片段高亮，支持按路径和标签过滤。
- `reference-graph`: 引用图引擎——解析 `[^N]: file.pdf, p.3` 脚注和 `[text](path.md)` wiki 链接为 `cites` 和 `links_to` 边。支持反向链接查询、未引用源文件检测、陈旧性传播。
- `ingest-pipeline`: 两步骤摄取——分析（Step 1）→ 生成（Step 2）→ 文件写入 → 引用图同步。SHA256 增量缓存跳过未变文件，页面合并保护防止重新摄取时丢数据。
- `mcp-server`: MCP 协议服务器——通过 HTTP POST 端点（`/mcp`）的 JSON-RPC 2.0 提供 6 个工具（guide、search、read、write、delete、ping），集成在 `llmwiki serve` 单进程中。首版不要求 Claude Desktop stdio 无改造直连。
- `cli-interface`: CLI 命令行——基于 cobra 的 `llmwiki init/serve/reindex` 等命令，供人直接操作或被脚本调用。
- `web-ui`: 嵌入式 Web 前端——React + TypeScript + Vite 构建，Go embed 打包进二进制，通过浏览器管理 Wiki。
- `llm-integration`: LLM 集成——内置 OpenAI/Anthropic 兼容的 streaming LLM 客户端，供摄取和查询使用。

### Modified Capabilities

<!-- No existing capabilities to modify -->

## Impact

- 新增 Go 项目结构：`cmd/llmwiki/`, `internal/{server,api,mcp,store,engine,watcher,llm,ingest}/`, `web/`
- 新增依赖：Go (1.22+)，SQLite (modernc.org/sqlite 或 mattn/go-sqlite3)，Node.js (仅构建时)
- 新增 CLI 命令：`llmwiki init / serve / reindex / ingest / version`
- 新增 HTTP 端点：`/api/v1/documents`, `/api/v1/search`, `/api/v1/graph/*`, `/mcp` (MCP RPC)
- 无数据库迁移：SQLite schema 为新建，不涉及已有数据迁移
- 无外部服务依赖：所有组件（Web UI、SQLite、MCP RPC、HTTP）打包为单一二进制，在单进程中运行
- 架构约束变更详见 `v1-architecture-constraints` 变更
