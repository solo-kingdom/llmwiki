## CLI 参考

常用命令（支持纯 PostgreSQL 模式，无需本地工作区目录）：

| 命令 | 说明 |
|------|------|
| `llmwiki init [dir]` | 初始化 PostgreSQL 工作区（传入 `[dir]` 时单向导入本地 Markdown 与规则） |
| `llmwiki serve [dir]` | 启动 HTTP API 与嵌入式 Web UI（默认 `127.0.0.1:8868`） |
| `llmwiki ingest <file>` | 将源文件摄入 Wiki（支持合并保护） |
| `llmwiki reindex` | 基于 PostgreSQL 内容重建分块（chunks）、引用图与目录总览 |
| `llmwiki lint [dir]` | 检查 Wiki 健康状态（默认检查 PostgreSQL；传入 `[dir]` 时检查本地目录） |
| `llmwiki export --out <dir>` | 从 PostgreSQL 导出页面（可选 `--include-raw`、`--with-index`） |
| `llmwiki cleanup-legacy` | 查找并清理遗留系统页（`wiki/log.md`、`wiki/index.md`、`wiki/templates/*`） |
| `llmwiki mcp` | 本地 stdio MCP |
| `llmwiki mcp-config` | 输出 Claude Desktop / Claude Code 用的 MCP JSON |
| `llmwiki version` | 版本信息 |

`serve` 常用标志：`--port`、`--token`（API 认证）、`--public-wiki`（公开只读 Wiki）、`--no-mcp`、`--mcp-allow-write`（远程 MCP 允许写入工具）。
