---
name: llmwiki-guide
description: 探索并理解 LLM Wiki 工作区。当需要了解工作区的目标、结构、已有页面或当前状态时使用，通常在任何操作之前执行。
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
  lang: zh
---

探索 LLM Wiki 工作区 — 了解其目标、结构和当前状态。

本 skill 是本项目 Go 代码内 prompts 的蓝本：先把外部 LLM Wiki 资料提炼为可读工作流，再映射到 `internal/ingest/prompts.go`、`internal/mcp/tools.go` 等运行时提示。它是设计源，不是运行时命令界面。

## 何时使用

- 首次接触一个工作区（"这个 wiki 里有什么？"）
- 在规划摄入或重组之前
- 当被问及"我们对 X 了解多少？"
- 作为 `/llmwiki-ingest`、`/llmwiki-query` 或 `/llmwiki-lint` 的前置步骤

## 核心不变量

- `raw/` 是不可变源材料层，只读不写；源文件修订应作为新来源加入。
- `wiki/` 是 LLM 维护的持久知识层；写入必须尊重 `purpose.md` 和 `rules.md`。
- 文件系统是真理源；`.llmwiki/index.db` / SQLite FTS5 只是可重建索引。
- 写入前必须搜索和阅读相关页面，写入后必须回读验证。
- `wiki/log.md` 是仅追加日志，条目格式为 `## [YYYY-MM-DD] action | description`。

## 步骤

1. **调用 MCP `guide` 工具**获取工作区概览
   - 当前实现会返回工作区架构说明、`wiki/` 顶层 Markdown 文件、`raw/sources/` 文件和 MCP 工具清单。
   - 它是快速入口，但不是完整目录树，也不等于已经读取了 `purpose.md` / `rules.md`。

2. **读取工作区约定**
   ```
   read(path="purpose.md")
   read(path="rules.md")
   read(path="wiki/overview.md")
   read(path="wiki/index.md")
   ```
   如果文件不存在，明确说明缺失，不要假设规则。

3. **深入探索内容**，使用 MCP `search` 工具：
   ```
   search(query="", mode="list")    → 所有 wiki 页面
   search(query="主题", mode="search")  → 全文搜索
   search(query="document-id", mode="references") → 引用图
   ```

4. **查看具体页面**，使用 MCP `read` 工具：
   ```
   read(path="wiki/entities/some-entity.md")
   ```

5. **选择下一步路由**：
   - 新材料入库、消化文件/URL/对话 → `/llmwiki-ingest`
   - 基于已有 wiki 回答问题或整理结构 → `/llmwiki-query`
   - 检查死链、frontmatter、孤立页、日志格式 → `/llmwiki-lint`

6. **总结**发现的内容：
   - 工作区目标和范围
   - 按类型统计页面数（实体、概念、来源等）
   - 已覆盖的关键主题
   - 值得注意的模式或空白

## 工作区结构

```
~/research/
├── purpose.md          # 研究目标（人与 LLM 共读）
├── rules.md            # 写作与引用规则
├── wiki/               # LLM 维护的结构化 Markdown
│   ├── entities/       # 人物、组织、产品
│   ├── concepts/       # 概念与术语
│   ├── sources/        # 源文件摘要
│   ├── synthesis/      # 跨源综合分析
│   ├── comparisons/    # 对比分析
│   ├── queries/        # 归档的问答
│   ├── overview.md     # 全局总览
│   ├── index.md        # 目录索引
│   └── log.md          # 仅追加操作日志
├── raw/                # 不可变源文件（只读）
│   └── sources/
└── .llmwiki/
    └── index.db        # SQLite FTS5 索引（可重建）
```

## 可用 MCP 工具

| 工具 | 用途 |
|------|------|
| `guide` | 工作区快速概览和工具清单 |
| `search` | 列出页面 / 全文搜索 / 引用图 / 健康检查 |
| `read` | 读取 wiki 页面 |
| `write` | 创建或更新 wiki 页面（用于理解 MCP 工具契约；服务内摄入主要通过 FILE 块和 pipeline 写入） |
| `delete` | 删除文档（`overview.md`、`log.md` 受 MCP 保护；`index.md` 也应视为系统页谨慎处理） |
| `ping` | 测试 MCP 连通性 |

## 约束

- 探索新工作区时始终先调用 `guide`
- 在任何写入操作前阅读 `purpose.md` 和 `rules.md`
- 文件系统是真理源；`index.db` 仅是可重建的索引
- 绝不修改 `raw/` 下的文件 — 它们是不可变源文件
- 不要把 `guide` 输出当成完整状态；需要结构化整理时继续使用 `search`、`read`、`references` 或 `/llmwiki-lint`
