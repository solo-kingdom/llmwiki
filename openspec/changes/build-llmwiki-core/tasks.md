# Tasks: build-llmwiki-core

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
- [ ] 2.7 编写 `internal/store/sqlite/` 的单元测试

## 3. 核心引擎

- [x] 3.1 创建 `internal/engine/chunker.go`，实现文本分块器（512 token target, 128 overlap, CJK bigram 感知）
- [x] 3.2 创建 `internal/engine/frontmatter.go`，实现 YAML frontmatter 解析器（正则 `\A---\n(.+?\n)---\n`），提取 title/date/tags/description
- [x] 3.3 创建 `internal/engine/references.go`，实现引用解析器——脚注 `[^N]: file, p.3` → cites 边 + wiki 链接 `[text](path)` → links_to 边
- [x] 3.4 创建 `internal/engine/references.go` 中的三层目标匹配逻辑（精确文件名 → base 去扩展名 → wiki 路径）
- [x] 3.5 创建 `internal/engine/staleness.go`，实现陈旧性传播（UPDATE 语句，仅 links_to 类型）
- [x] 3.6 创建 `internal/engine/reindex.go`，实现全量重索引逻辑（删除旧数据 → 扫描文件系统 → 读文本+解析 frontmatter → 重建引用图 → 重新分块）
- [ ] 3.7 编写引擎模块的单元测试

## 4. 文档存储层

- [x] 4.1 创建 `internal/store/document_service.go`，封装文档 CRUD 业务逻辑（文件名 slugify、路径安全校验、双写文件系统+DB）
- [x] 4.2 实现 cascade deletion 逻辑（删除源文件 → 清理关联 wiki 页面的 sources[] → 清理死 wikilinks）
- [x] 4.3 实现 overview.md 和 log.md 的删除保护
- [ ] 4.4 编写文档存储的集成测试

## 5. 搜索引擎

- [x] 5.1 创建 `internal/store/sqlite/chunks.go`，封装 FTS5 搜索查询（JOIN document_chunks + documents，BM25 rank，path/tag 过滤）
- [x] 5.2 实现搜索结果上下文片段提取（120 字符前后文，查询词高亮位置）
- [x] 5.3 实现文档列表/浏览功能（ListDocuments + ListDocumentsWithContent 已实现）
- [ ] 5.4 验证 FTS5 + CJK bigram 分词的实际效果，根据需要调整 tokenizer

## 6. 引用图引擎

- [x] 6.1 创建 `internal/engine/staleness.go`，封装引用图查询（反向链接、正向引用、未引用源、陈旧页面）
- [x] 6.2 实现写入后自动同步引用图（SyncReferencesAfterWrite: parse → delete edges → insert edges → propagate staleness）
- [ ] 6.3 实现写入后影响面报告（backlinks 列表显示）
- [ ] 6.4 实现读取时自动附加反向链接摘要（\"Referenced by (N)\" appendix）
- [ ] 6.5 验证引用图在 reindex 后完整恢复

## 7. 文件监视器

- [x] 7.1 创建 `internal/watcher/watcher.go`，基于 fsnotify 实现文件变更监听
- [x] 7.2 实现自写保护（MarkWritten() + 4 秒 cooldown，防止自写文件触发重索引）
- [x] 7.3 实现防抖批处理（timer-based: 700ms 窗口内收集变更，批量回调）
- [x] 7.4 实现忽略规则（.llmwiki/, .git/, node_modules/, 以.开头的目录）
- [ ] 7.5 实现变更处理回调（创建 → 索引；修改 → 更新索引+re-chunk；删除 → 归档 DB 记录）
- [ ] 7.6 Linux 平台定期重扫描（10s 间隔），补偿 inotify 丢事件
- [ ] 7.7 编写文件监视器的单元测试

## 8. 工作区管理

- [ ] 8.1 实现 `llmwiki init <dir>` 命令——创建目录结构、初始化 SQLite、脚手架 overview.md/log.md、扫描已有文件并索引
- [ ] 8.2 实现 `llmwiki reindex <dir>` 命令——调用 engine/reindex.go 全量重建
- [ ] 8.3 实现工作区发现（`.llmwiki/index.db` 存在性检测）
- [ ] 8.4 实现 `purpose.md` 模板生成（如果引入此功能）

## 9. MCP Server（JSON-RPC 2.0 over stdio）

- [x] 9.1 创建 `internal/mcp/server.go`，实现 stdio transport（stdin 读行 → JSON 解析；JSON 序列化 → stdout 写；stderr 日志）
- [x] 9.2 创建 `internal/mcp/server.go`，实现 JSON-RPC 2.0 协议处理（initialize, tools/list, tools/call）
- [x] 9.3 创建 `internal/mcp/tools.go`，实现 6 个工具的注册（guide, search, read, write, delete, ping）——含 stubs
- [ ] 9.4 实现 guide 工具（返回架构文档 + 工作区列表）
- [ ] 9.5 实现 search/read/write/delete 工具的具体逻辑
- [ ] 9.6-9.9 其他 MCP 详细实现和测试

## 10. CLI 接口（Cobra）

- [x] 10.1 注册所有 CLI 命令：`init`, `serve`, `reindex`, `mcp`, `mcp-config`, `version`（已在 commands.go/serve.go/version.go 中注册）
- [x] 10.2 实现 `llmwiki serve` 的 flags：`--port`, `--bind`, `--token`, `--no-mcp`, `--no-watch`
- [ ] 10.3 实现 `llmwiki mcp-config` 输出 Claude/Claude Code 配置 JSON
- [x] 10.4 实现 `llmwiki version` 输出（ldflags 注入 git commit + build date）

## 11. LLM 集成

- [x] 11.1 创建 `internal/llm/client.go`，定义 LLM Client（StreamChat）和请求/响应类型
- [ ] 11.2-11.7 OpenAI/Anthropic/Ollama providers 和超时/错误分类（client.go 含基础框架）

## 12. 摄取 Pipeline

- [x] 12.1 创建 `internal/ingest/pipeline.go`，实现两步骤摄取编排（Step 1: Analysis → Step 2: Generation → Step 3: Write）——含 stubs
- [ ] 12.2-12.8 缓存、合并保护、FILE 块解析器、队列等（pipeline.go 含基础框架）

## 13. HTTP API 服务

- [x] 13.1 创建 `internal/server/server.go`，注册所有 API 路由（已有完整路由 + handler stubs）
- [x] 13.6 实现健康检查端点（`/api/v1/health`）
- [x] 13.7 实现 CORS 中间件和服务日志中间件（chi middleware）
- [x] 13.8 实现可选 Token 认证中间件（`Authorization: Bearer <token>`）
- [ ] 13.2-13.5, 13.9 其他 API 端点实现和测试

## 14. Web 前端

- [ ] 14.1 初始化 React + TypeScript + Vite 项目（`web/` 目录）
- [ ] 14.2 配置 Tailwind CSS v4 + shadcn/ui（或自选 UI 框架）
- [ ] 14.3 实现侧边栏导航（文件树 + 文件夹展开/折叠）
- [ ] 14.4 实现文档内容查看器（Markdown 渲染：GFM 表格、代码块、wikilink 处理）
- [ ] 14.5 实现搜索栏（实时搜索 + 结果列表 + 片段高亮）
- [ ] 14.6 实现设置页面（LLM provider/API key/model 配置）
- [ ] 14.7 实现基本状态管理（Zustand 或 React Context）
- [ ] 14.8 配置 Vite 代理（开发时将 `/api/` 转发到 Go backend）
- [ ] 14.9 验证 `npm run build` 产物大小，确认适合 Go embed

## 15. 构建、嵌入与打包

- [ ] 15.1 在 Go server 中实现 `embed.FS` 打包 web/dist/
- [ ] 15.2 实现 SPA fallback handler（非 `/api/` 路径返回 index.html）
- [ ] 15.3 配置 ldflags 注入版本信息（version, commit, buildDate）
- [ ] 15.4 编写 Makefile 目标：`build-web` (npm build), `build-go` (go build), `build` (both)
- [ ] 15.5 交叉编译验证（Linux amd64/arm64, macOS amd64/arm64）
- [ ] 15.6 端到端测试：init → serve → Web UI 访问 → MCP 连接 → 源文件摄取 → 搜索 → 删除

## 16. 文档与收尾

- [ ] 16.1 编写 README.md（Quick Start、CLI 命令参考、项目结构）
- [ ] 16.2 确保所有 `docs/` 下的探索文档与最终实现一致（更新偏差）
- [ ] 16.3 检查 `.gitignore` 覆盖 `.llmwiki/`、`web/dist/`、`web/node_modules/`
- [ ] 16.4 最终验证：`openspec status --change "build-llmwiki-core"` 确认所有 artifact 完成
