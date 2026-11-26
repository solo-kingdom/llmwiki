## CLI 参考

常用命令（在工作区目录或指定路径执行）：

| 命令 | 说明 |
|------|------|
| `llmwiki init <dir>` | 初始化工作区 scaffold 与 PostgreSQL 修订历史 |
| `llmwiki serve [dir]` | 启动 HTTP API 与嵌入式 Web UI（默认 `127.0.0.1:8868`） |
| `llmwiki ingest <file>` | 将源文件摄入 Wiki（支持合并保护） |
| `llmwiki reindex [dir]` | 从文件系统强制重建索引 |
| `llmwiki mcp [dir]` | 本地 stdio MCP（旧模式） |
| `llmwiki mcp-config` | 输出 Claude Desktop / Claude Code 用的 MCP JSON |
| `llmwiki version` | 版本信息 |

`serve` 常用标志：`--port`、`--token`（API 认证）、`--public-wiki`（公开只读 Wiki）、`--no-mcp`、`--no-watch`、`--mcp-allow-write`（远程 MCP 允许写入工具）。
