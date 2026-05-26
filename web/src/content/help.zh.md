## 快速开始

1. **初始化工作区**（需要本机安装 git CLI）：

```bash
llmwiki init ~/research
```

2. **启动服务**并打开 Web UI：

```bash
llmwiki serve ~/research
# 浏览器访问 http://127.0.0.1:8868
```

3. **配置 Provider**：在「设置」中添加 LLM Provider 实例并选择模型。

4. **摄入知识**：在「摄入」中与助手对话，或「添加上下文」粘贴材料，满意后点击「归档」经审核写入 Wiki。

5. **阅读 Wiki**：点击顶栏「Wiki」浏览已生成的结构化页面。

## 核心理念

LLM Wiki 与传统 RAG 的本质区别：

| 传统 RAG | LLM Wiki |
|----------|----------|
| 查询时检索碎片、临时拼凑 | 摄取时编译知识、写入持久 Markdown |
| 每次问答从零开始 | 知识随源文件与对话累积 |

三大操作：

- **Ingest（摄取）**：将源材料或对话归档为 Wiki 页面，更新交叉引用与索引。
- **Query（查询）**：针对已有 Wiki 提问；优质回答可归档回 Wiki，不会消失在聊天记录中。
- **Lint（维护）**：检查矛盾、过时声明、孤立页面与缺失链接（可通过 MCP 或后续工具触发）。

文件系统是真理源；`.llmwiki/index.db` 仅为可重建的搜索索引。

## 工作区结构

初始化后的典型布局：

```
~/research/
├── purpose.md          # 研究目标与范围（人与 LLM 共读）
├── rules.md            # Wiki 写作与引用规则
├── wiki/               # LLM 维护的结构化 Markdown
├── raw/                # 不可变源文件（只读）
│   └── sources/
└── .llmwiki/
    └── index.db        # SQLite 索引（可 delete + reindex 重建）
```

- **`raw/`**：原始 PDF、笔记、Web 归档等，LLM 只读不写。
- **`wiki/`**：LLM 生成的知识页，按类型分子目录（见下文）。
- **`purpose.md` / `rules.md`**：在 Obsidian 或编辑器中修改；Settings 页可预览并追加「补充规则」。

## Wiki 如何组织

业务知识页按 **页面类型** 存放在固定目录：

| 类型 | 目录 | 说明 |
|------|------|------|
| entity | `wiki/entities/` | 人物、组织、产品等实体 |
| concept | `wiki/concepts/` | 概念与术语 |
| source | `wiki/sources/` | 源文件摘要 |
| synthesis | `wiki/synthesis/` | 跨源综合分析 |
| comparison | `wiki/comparisons/` | 对比分析 |
| query | `wiki/queries/` | 归档的问答结果 |

保留的顶层系统页：`wiki/overview.md`（全局总览）、`wiki/index.md`（目录）、`wiki/log.md`（操作日志）。模板在 `wiki/templates/`，供生成参考而非业务内容。

写入已有页面时默认 **合并** 而非覆盖：锁定 frontmatter 字段、数组合并、正文由 LLM 合并（可用 CLI `--force-overwrite` 恢复覆盖行为）。

## Web UI 使用指南

Workbench 顶栏导航：

| 页面 | 用途 |
|------|------|
| **摄入** | 多轮对话探索主题；「添加上下文」粘贴纯文本（不触发 AI 回复）；附件上传；「归档」提交审核 |
| **任务** | 查看 ingest 任务状态（queued / running / succeeded / failed），重试或取消 |
| **时间线** | 查看 wiki 的 git 提交历史与 diff（需 init 时启用版本控制） |
| **日志** | 系统活动日志 |
| **设置** | Provider、界面/文档语言、Wiki 规则补充、MCP 配置等 |
| **Wiki** | 只读阅读器：目录树、全文搜索（⌘K / Ctrl+K）、知识图谱 |

推荐工作流：**对话或添加上下文 → 归档 → 在审核卡片中确认计划 → Jobs 观察执行 → Wiki 阅读结果**。

## CLI 参考

常用命令（在工作区目录或指定路径执行）：

| 命令 | 说明 |
|------|------|
| `llmwiki init <dir>` | 初始化工作区 scaffold、git（wiki/）、SQLite 索引 |
| `llmwiki serve [dir]` | 启动 HTTP API 与嵌入式 Web UI（默认 `127.0.0.1:8868`） |
| `llmwiki ingest <file>` | 将源文件摄入 Wiki（支持合并保护） |
| `llmwiki reindex [dir]` | 从文件系统强制重建索引 |
| `llmwiki mcp [dir]` | 本地 stdio MCP（旧模式） |
| `llmwiki mcp-config` | 输出 Claude Desktop / Claude Code 用的 MCP JSON |
| `llmwiki version` | 版本信息 |

`serve` 常用标志：`--port`、`--token`（API 认证）、`--public-wiki`（公开只读 Wiki）、`--no-mcp`、`--no-watch`。

## MCP 接入

首选 **RPC-first** 模式：`llmwiki serve` 在同一进程暴露 MCP HTTP 端点 `POST /mcp`（JSON-RPC 2.0）。

1. 启动服务：`llmwiki serve ~/research`
2. 生成客户端配置：`llmwiki mcp-config`
3. 将配置粘贴到 Claude Desktop / Claude Code 等 MCP 客户端

客户端可通过 MCP 工具读取 Wiki、搜索、触发诊断等（具体工具列表以 `tools/list` 为准）。stdio 模式 `llmwiki mcp` 仍可用，但 HTTP RPC 为推荐接入方式。

## 常见问题

**Q：删除 `.llmwiki/index.db` 会丢数据吗？**  
A：不会。Wiki 与 raw 文件仍在；运行 `llmwiki reindex` 即可重建索引。

**Q：界面语言与生成文档语言一样吗？**  
A：不一定。Settings 中 `ui_language` 控制界面，`doc_language` 控制 Wiki 生成语言。

**Q：PDF / Office 无法解析？**  
A：查看 Settings 或 `GET /api/v1/capabilities` 的处理 tier；Tier B 可能需要 `pdftotext` 或 LibreOffice。

**Q：升级后中文搜索异常？**  
A：拉取含 CJK 搜索改进的版本后，执行一次 `llmwiki reindex`。

**Q：Web 提交的材料存在哪？**  
A：归档前会持久化到 `raw/sources/web-ingest/`，再进入 ingest 管线。
