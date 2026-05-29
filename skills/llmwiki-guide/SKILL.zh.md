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

## 何时使用

- 首次接触一个工作区（"这个 wiki 里有什么？"）
- 在规划摄入或重组之前
- 当被问及"我们对 X 了解多少？"
- 作为 `/llmwiki-ingest`、`/llmwiki-query` 或 `/llmwiki-lint` 的前置步骤

## 步骤

1. **调用 MCP `guide` 工具**获取工作区概览
   - 返回：`purpose.md`、`rules.md`、页面计数、文件列表
   - 这是了解工作区最快的方式

2. **如需深入探索**，使用 MCP `search` 工具：
   ```
   search(query="", mode="list")    → 所有 wiki 页面
   search(query="主题", mode="search")  → 全文搜索
   ```

3. **查看具体页面**，使用 MCP `read` 工具：
   ```
   read(path="wiki/entities/some-entity.md")
   ```

4. **总结**发现的内容：
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
| `guide` | 工作区概览（目标、规则、文件列表） |
| `search` | 列出页面 / 全文搜索 / 健康检查 |
| `read` | 读取 wiki 页面 |
| `write` | 创建或编辑 wiki 页面 |
| `delete` | 删除页面（系统页面受保护） |

## 约束

- 探索新工作区时始终先调用 `guide`
- 在任何写入操作前阅读 `purpose.md` 和 `rules.md`
- 文件系统是真理源；`index.db` 仅是可重建的索引
- 绝不修改 `raw/` 下的文件 — 它们是不可变源文件
