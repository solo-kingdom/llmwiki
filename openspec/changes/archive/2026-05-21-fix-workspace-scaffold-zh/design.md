## Context

本项目已实现 LLM Wiki 核心能力（两步骤摄取、FTS5、MCP、Web UI、引用图、Review gate 等），但 workspace 脚手架与 Karpathy 原始模式及 gap 分析（`docs/14`）存在偏差：

- `llmwiki init` 仅创建 3 个 wiki 子目录，无 `wiki/index.md`、无 `.obsidian/`、无 `raw/assets/`
- 引导文件为英文占位符，与默认 `doc_language=zh` 不一致
- `reindex` 只重建 SQLite 索引，不重建 `wiki/index.md`

约束：

- 文件系统为 FileTruth；`wiki/index.md` 是可从 wiki 页面 frontmatter 衍生的确定性产物（参考 LLM-Wiki-Skilled `rebuild_index.py`）
- 中文为主；scaffold 默认中文，保留 YAML frontmatter 供 LLM 解析
- Web UI + MCP 同等重要；index.md 是双入口共享的导航层
- 尚无真实 workspace；init 应幂等补全缺失结构，不覆盖已有内容

## Goals / Non-Goals

**Goals:**

- `llmwiki init` 一次性创建完整 Karpathy/nashsu 对齐的 workspace 骨架
- 中文引导 scaffold，降低 LLM 冷启动混乱
- `reindex` 末尾幂等重建 `wiki/index.md`
- 最小 Obsidian 兼容配置
- 已初始化 workspace 可安全补全缺失目录/文件

**Non-Goals:**

- ingest 完成后自动更新 index（后续 change 复用同一 builder）
- lint `--check-index` 索引过时检测
- 页面模板、合并保护、CJK 分词
- Dataview 等 Obsidian 社区插件安装

## Decisions

### Decision 1: 完整目录列表

init 创建以下目录（`.gitkeep` 占位空子目录）：

```
wiki/
wiki/entities/
wiki/concepts/
wiki/sources/
wiki/synthesis/
wiki/comparisons/
wiki/queries/
raw/sources/
raw/assets/
revert/
.llmwiki/
.llmwiki/cache/
.obsidian/
```

**理由**: 对齐 Karpathy 6 类 wiki 子目录 + nashsu/Skilled 的 `raw/assets/` 分离。

### Decision 2: init 幂等策略

| 操作 | 已存在时行为 |
|------|-------------|
| 目录 | `MkdirAll`，始终确保存在 |
| scaffold 文件 | 仅当文件不存在时写入 |
| `.obsidian/` 配置 | 仅当目标文件不存在时写入 |
| SQLite / reindex | 仅首次初始化时创建 DB 并 reindex |

**理由**: 当前 `isWorkspaceInitialized` 检测到 DB 后直接 return，无法补全 gap。改为：**无论是否已初始化，都执行目录/scaffold 补全**；DB 创建与首次 reindex 仍仅在未初始化时执行。

### Decision 3: 中文 scaffold 内容

**`purpose.md`** — 含结构化 YAML：

```yaml
---
title: 研究目标
goals: []
key_questions: []
scope: ""
---
```

正文为中文引导提示（研究目标、关键问题、范围）。

**`wiki/overview.md`** — 中文全局总览占位（项目目标、当前状态、主要主题）。

**`wiki/log.md`** — 首条 init 记录：

```markdown
## [YYYY-MM-DD] init | 工作区初始化
```

日期取 init 执行日（ISO 8601）。

**`wiki/index.md`** — 中文分组空表格框架（见 Decision 4）。

### Decision 4: index.md 格式

生成格式（中文 section 标题 + Markdown 表格）：

```markdown
---
title: 内容目录
type: index
date: YYYY-MM-DD
---

# 内容目录

> 本文件由 `llmwiki reindex` 自动维护，请勿手动编辑。

## 实体 (entities)

| 页面 | 标题 | 摘要 | 更新日期 |
|------|------|------|----------|

## 概念 (concepts)
...
## 源摘要 (sources)
...
## 综合分析 (synthesis)
...
## 对比分析 (comparisons)
...
## 查询归档 (queries)
...
```

**条目规则**:

- 扫描 `wiki/{entities,concepts,sources,synthesis,comparisons,queries}/` 下 `*.md`
- **排除**: `wiki/index.md`、`wiki/log.md`、`wiki/overview.md`（导航/元页面，非内容页）
- 页面列：`[[entities/slug|显示名]]` wikilink 格式
- 标题：frontmatter `title`，fallback 文件名 slug 美化
- 摘要：frontmatter `description`，截断 80 字符
- 更新日期：frontmatter `date`，fallback 文件 mtime（ISO 8601 日期部分）
- 按标题字母/拼音排序（首版：文件名排序，简单可测）

**幂等性**: 相同 wiki 页面集合 + 相同 frontmatter → 相同 index 内容（除生成日期 header 外稳定）。

### Decision 5: index 重建集成点

在 `Reindexer.Rebuild()` 流程末尾：

```
1. Walk + index 所有文件
2. rebuildReferences()
3. verifyRecovery()
4. IndexBuilder.Rebuild() → 写入 wiki/index.md
5. indexFile("wiki/index.md") → 索引 index 自身
```

**file watcher**: 使用现有 self-write 标记（4s cooldown）避免循环；reindex 为 CLI/批量操作，watcher 通常不在同路径竞争。

### Decision 6: Obsidian 最小配置

| 文件 | 内容 |
|------|------|
| `.obsidian/app.json` | `"promptDelete": false`, `"showLineNumber": true` 等基础项 |
| `.obsidian/app.json` 或单独 | 不强制 community plugins |

**理由**: Karpathy 推荐 Obsidian 浏览；最小配置即可打开 wikilink 图视图，不绑定特定插件。

`.obsidian/` 已被 file watcher 忽略（隐藏目录规则）。

### Decision 7: 模块划分

新增 `internal/engine/index_builder.go`:

- `IndexBuilder` struct（workspace path）
- `BuildIndex() (string, error)` — 返回 markdown 内容
- `WriteIndex() error` — 写入 `wiki/index.md`
- `RebuildIndex() error` — Build + Write

init scaffold 模板提取到 `internal/engine/scaffold.go` 或 `cmd/llmwiki/scaffold/` 以保持 init.go 可读（实现时二选一，优先 engine 包内常量 + 测试）。

## Architecture

```
llmwiki init
    │
    ├─ ensureDirs (6 wiki + raw/assets + .obsidian + ...)
    ├─ writeScaffoldsIfMissing (purpose, overview, log, index 框架)
    ├─ writeObsidianIfMissing
    └─ [首次] create DB + reindex
              │
              └─ Reindexer.Rebuild()
                    └─ IndexBuilder.RebuildIndex()  ← 新增

llmwiki reindex
    └─ Reindexer.Rebuild()
          └─ IndexBuilder.RebuildIndex()  ← 新增
```

## Risks / Mitigations

| 风险 | 缓解 |
|------|------|
| reindex 写 index 触发 watcher 循环 | self-write cooldown；reindex 为同步 CLI 操作 |
| init 覆盖用户编辑的 scaffold | 仅 `Stat` 不存在时写入 |
| index 与 ingest 时 LLM 写的 index 冲突 | ingest 暂不自动更新；reindex 为权威重建；后续 ingest 可调用同一 builder |
| 空 workspace index 只有表头 | 符合预期；init 框架即够用 |

## Open Questions

- ingest 完成后是否调用 index rebuild？**本 change 不做**，后续 change 一行集成。
- index 排序用文件名还是 title？**首版文件名**，简单稳定。
