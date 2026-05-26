# Tasks: build-llmwiki-core

> **注意**: 本变更的架构约束已由 `v1-architecture-constraints` 变更细化。以下任务已同步 RPC-first MCP、并发控制、引用图事务、分层源处理、LLM 配置管理等决策。

## 1. 项目脚手架与基础设施

- [x] 1.1 初始化 Go module (`go mod init github.com/solo-kingdom/llmwiki`)，创建目录结构 (`cmd/llmwiki/`, `internal/{server,api,mcp,store,engine,watcher,llm,ingest}/`)
- [x] 1.2 创建 Makefile，定义 `build`, `run`, `test`, `lint`, `clean` 目标
- [x] 1.3 引入核心 Go 依赖：modernc.org/sqlite（或 mattn/go-sqlite3），cobra，chi（或 net/http 标准库），fsnotify，yaml.v3
- [x] 1.4 创建 `cmd/llmwiki/main.go` 入口文件，集成 cobra CLI root command
- [x] 1.5 创建 `internal/server/server.go` HTTP server 骨架（启动/关闭、路由注册、embed web assets）
- [x] 1.6 配置 OpenSpec 项目 context (`openspec/config.yaml` 添加 tech stack 和 conventions）

## 2. SQLite Schema 与数据层

- [x] 2.1 创建 `internal/store/schema.sql`，包含 documents、document_pages、document_chunks、document_references、chunks_fts (FTS5) 五张表及索引、触发器
- [x] 2.2 创建 `internal/store/sqlite/db.go`，实现数据库连接管理（Open/Close、WAL mode、外键启用）
- [x] 2.3 创建 `internal/store/sqlite/migrations.go`，实现 schema 执行
- [x] 2.4 创建 `internal/store/sqlite/documents.go`，实现 documents 表 CRUD（Create, Get, FindByName, Update, Archive, List, ListWithContent）
- [x] 2.5 创建 `internal/store/sqlite/chunks.go`，实现 chunks 的增删查（StoreChunks, DeleteChunks, SearchChunks）
- [x] 2.6 创建 `internal/store/sqlite/references.go`，实现引用图 CRUD（DeleteReferences, UpsertReference, GetBacklinks, GetForwardReferences, FindUncitedSources, FindStalePages, PropagateStaleness）
- [x] 2.7 编写 `internal/store/sqlite/` 的单元测试

## 3. 核心引擎

- [x] 3.1 创建 `internal/engine/chunker.go`，实现文本分块器（512 token target, 128 overlap, CJK bigram 感知）
- [x] 3.2 创建 `internal/engine/frontmatter.go`，实现 YAML frontmatter 解析器（正则 `\A---\n(.+?\n)---\n`），提取 title/date/tags/description
- [x] 3.3 创建 `internal/engine/references.go`，实现引用解析器——脚注 `[^N]: file, p.3` → cites 边 + wiki 链接 `[text](path)` → links_to 边
- [x] 3.4 创建 `internal/engine/references.go` 中的三层目标匹配逻辑（精确文件名 → base 去扩展名 → wiki 路径）
- [x] 3.5 创建 `internal/engine/staleness.go`，实现陈旧性传播（UPDATE 语句，仅 links_to 类型）
- [x] 3.6 创建 `internal/engine/reindex.go`，实现全量重索引逻辑（删除旧数据 → 扫描文件系统 → 读文本+解析 frontmatter → 重建引用图 → 重新分块）
- [x] 3.7 编写引擎模块的单元测试

## 4. 文档存储层

- [x] 4.1 创建 `internal/store/document_service.go`，封装文档 CRUD 业务逻辑（文件名 slugify、路径安全校验、双写文件系统+DB）
- [x] 4.2 实现 cascade deletion 逻辑（删除源文件 → 清理关联 wiki 页面的 sources[] → 清理死 wikilinks）
- [x] 4.3 实现 overview.md 和 log.md 的删除保护
- [x] 4.4 编写文档存储的集成测试

## 5. 搜索引擎

- [x] 5.1 创建 `internal/store/sqlite/chunks.go`，封装 FTS5 搜索查询（JOIN document_chunks + documents，BM25 rank，path/tag 过滤）
- [x] 5.2 实现搜索结果上下文片段提取（120 字符前后文，查询词高亮位置）
- [x] 5.3 实现文档列表/浏览功能（ListDocuments + ListDocumentsWithContent 已实现）
- [x] 5.4 验证 FTS5 + CJK bigram 分词的实际效果，根据需要调整 tokenizer

## 6. 引用图引擎（含事务性更新）

- [x] 6.1 创建 `internal/engine/staleness.go`，封装引用图查询（反向链接、正向引用、未引用源、陈旧页面）
- [x] 6.2 实现写入后自动同步引用图（SyncReferencesAfterWrite: parse → delete edges → insert edges → propagate staleness）
- [x] 6.3 重构引用图刷新为事务性操作（delete old + upsert new 在同一 DB 事务内，失败回滚）— *v1-architecture-constraints: reference-graph-transactional-update*
- [x] 6.4 验证幂等 upsert 行为（唯一约束 + 重试不产生重复边）— *v1-architecture-constraints: reference-graph-transactional-update*
- [x] 6.5 实现写入后影响面报告（backlinks 列表显示）
- [x] 6.6 实现读取时自动附加反向链接摘要（"Referenced by (N)" appendix）
- [x] 6.7 验证引用图在 reindex 后完整恢复

## 7. 文件监视器

- [x] 7.1 创建 `internal/watcher/watcher.go`，基于 fsnotify 实现文件变更监听
- [x] 7.2 实现自写保护（MarkWritten() + 4 秒 cooldown，防止自写文件触发重索引）
- [x] 7.3 实现防抖批处理（timer-based: 700ms 窗口内收集变更，批量回调）
- [x] 7.4 实现忽略规则（.llmwiki/, .git/, node_modules/, 以.开头的目录）
- [x] 7.5 实现变更处理回调（创建 → 索引；修改 → 更新索引+re-chunk；删除 → 归档 DB 记录）
- [x] 7.6 Linux 平台定期重扫描（10s 间隔），补偿 inotify 丢事件
- [x] 7.7 编写文件监视器的单元测试

## 8. 工作区管理

- [x] 8.1 实现 `llmwiki init <dir>` 命令——创建目录结构、初始化 SQLite、脚手架 overview.md/log.md、扫描已有文件并索引
- [x] 8.2 实现 `llmwiki reindex <dir>` 命令——调用 engine/reindex.go 全量重建
- [x] 8.3 实现工作区发现（`.llmwiki/index.db` 存在性检测）
- [x] 8.4 实现 `purpose.md` 模板生成（如果引入此功能）

## 9. MCP Server（JSON-RPC 2.0 over RPC — 单进程内）

- [x] 9.1 创建 `internal/mcp/server.go`，实现 JSON-RPC 2.0 协议处理（initialize, tools/list, tools/call）
- [x] 9.2 创建 `internal/mcp/tools.go`，实现 6 个工具的注册（guide, search, read, write, delete, ping）——含 stubs
- [x] 9.3 重构 MCP 暴露方式为 RPC 端点（`/mcp` HTTP POST），集成到 `llmwiki serve` 单进程路由中 — *v1-architecture-constraints: mcp-rpc-access-model*
- [x] 9.4 添加 MCP RPC 端点合约测试（initialize, tools/list, tools/call）
- [x] 9.5 实现 guide 工具（返回架构文档 + 工作区列表）
- [x] 9.6 实现 search/read/write/delete 工具的具体逻辑
- [x] 9.7 验证 MCP RPC 与 HTTP API 共享同一 store/engine 依赖上下文
- [x] 9.8 在 capabilities/health 端点中暴露 MCP RPC 可用性

## 10. CLI 接口（Cobra）

- [x] 10.1 注册 CLI 命令：`init`, `serve`, `reindex`, `version`（移除独立 `mcp` 命令，MCP 已集成到 serve）
- [x] 10.2 实现 `llmwiki serve` 的 flags：`--port`, `--bind`, `--token`, `--no-mcp`, `--no-watch`
- [x] 10.3 实现 `llmwiki mcp-config` 输出 RPC MCP 端点配置 JSON（指向 `/mcp` HTTP POST 端点）
- [x] 10.4 实现 `llmwiki version` 输出（ldflags 注入 git commit + build date）

## 11. LLM 集成

- [x] 11.1 创建 `internal/llm/client.go`，定义 LLM Client（StreamChat）和请求/响应类型
- [x] 11.2-11.7 OpenAI/Anthropic/Ollama providers 和超时/错误分类（client.go 含基础框架）

## 12. 摄取 Pipeline（含并发控制）

- [x] 12.1 创建 `internal/ingest/pipeline.go`，实现两步骤摄取编排（Step 1: Analysis → Step 2: Generation → Step 3: Write）——含 stubs
- [x] 12.2 引入页面级 mutex 管理器（keyed by normalized page path）— *v1-architecture-constraints: ingest-concurrency-control*
- [x] 12.3 将锁管理器接入摄取写路径，保证同页面串行、跨文件并发 — *v1-architecture-constraints: ingest-concurrency-control*
- [x] 12.4 添加锁等待/持有时长指标埋点，超阈值输出结构化诊断 — *v1-architecture-constraints: ingest-concurrency-control*
- [x] 12.5 实现 SHA256 增量缓存、合并保护、FILE 块解析器
- [x] 12.6 实现摄取队列（SQLite-backed, crash recovery, max 3 retry）
- [x] 12.7 编写并发摄取测试（跨文件并行 + 同页面争用场景）

## 13. HTTP API 服务（单进程）

- [x] 13.1 创建 `internal/server/server.go`，注册所有 API 路由 + MCP RPC 端点（`/mcp`）+ Web SPA fallback
- [x] 13.2 实现健康检查端点（`/api/v1/health`）——含 MCP RPC 启用状态
- [x] 13.3 实现 CORS 中间件和服务日志中间件（chi middleware）
- [x] 13.4 实现可选 Token 认证中间件（`Authorization: Bearer <token>`）
- [x] 13.5 实现文档 CRUD API 端点（`/api/v1/documents/*`）
- [x] 13.6 实现搜索 API 端点（`/api/v1/search`）
- [x] 13.7 实现引用图 API 端点（`/api/v1/graph/*`）
- [x] 13.8 实现 LLM 配置读写 API 端点（`/api/v1/settings`）— *v1-architecture-constraints: llm-config-management*
- [x] 13.9 实现源文件处理能力报告 API 端点（`/api/v1/capabilities`）— *v1-architecture-constraints: tiered-source-processing-v1*
- [x] 13.10 编写 HTTP API 集成测试

## 14. 分层源文件处理（PDF/Office V1）

- [x] 14.1 实现源处理层级选择器（Layer A: 内建 Go 解析 → Layer B: 可选系统依赖 → Layer C: 降级标记）— *v1-architecture-constraints: tiered-source-processing-v1*
- [x] 14.2 实现运行时依赖探测（pdftotext, LibreOffice 可用性检查）
- [x] 14.3 实现结构化降级响应（fallback tier + missing dependency + remediation hint）
- [x] 14.4 在 API/UI/日志中暴露当前处理层级与降级原因
- [x] 14.5 编写分层处理测试（三层降级路径覆盖）

## 15. LLM 配置管理

- [x] 15.1 实现 `.llmwiki/config.json` 读写逻辑（provider, API key, model, base URL, timeouts）— *v1-architecture-constraints: llm-config-management*
- [x] 15.2 实现配置来源优先级：config.json 优先 → 环境变量回退 — *v1-architecture-constraints: llm-config-management*
- [x] 15.3 实现配置热加载（LLM client 使用最新配置无需重启）
- [x] 15.4 实现超时策略可配置（request timeout, streaming idle timeout）— *v1-architecture-constraints: llm-config-management*
- [x] 15.5 编写配置管理测试（多 provider 扩展、环境变量回退）

## 16. Web 前端

- [x] 16.1 初始化 React + TypeScript + Vite 项目（`web/` 目录）
- [x] 16.2 配置 Tailwind CSS v4 + shadcn/ui
- [x] 16.3 实现侧边栏导航（文件树 + 文件夹展开/折叠）
- [x] 16.4 实现文档内容查看器（Markdown 渲染：GFM 表格、代码块、wikilink 处理）
- [x] 16.5 实现搜索栏（实时搜索 + 结果列表 + 片段高亮）
- [x] 16.6 实现设置页面（LLM provider/API key/model/base URL/timeout 配置）— *v1-architecture-constraints: llm-config-management*
- [x] 16.7 实现基本状态管理（React Context）
- [x] 16.8 配置 Vite 代理（开发时将 `/api/` 转发到 Go backend）
- [x] 16.9 验证 `npm run build` 产物大小，确认适合 Go embed

## 17. 构建、嵌入与打包

- [x] 17.1 在 Go server 中实现 `embed.FS` 打包 web/dist/
- [x] 17.2 实现 SPA fallback handler（非 `/api/` 和 `/mcp` 路径返回 index.html）
- [x] 17.3 配置 ldflags 注入版本信息（version, commit, buildDate）
- [x] 17.4 编写 Makefile 目标：`build-web` (npm build), `build-go` (go build), `build` (both)
- [x] 17.5 交叉编译验证（Linux amd64/arm64, macOS amd64/arm64）
- [x] 17.6 端到端测试：init → serve → Web UI 访问 → MCP RPC 调用 → 源文件摄取 → 搜索 → 删除

## 18. 文档与收尾

- [x] 18.1 编写 README.md（Quick Start、CLI 命令参考、项目结构、MCP RPC-first 兼容性说明）
- [x] 18.2 确保所有 `docs/` 下的探索文档与最终实现一致（更新偏差）
- [x] 18.3 检查 `.gitignore` 覆盖 `.llmwiki/`、`web/dist/`、`web/node_modules/`
- [x] 18.4 最终验证：`openspec status --change "build-llmwiki-core"` 确认所有 artifact 完成
