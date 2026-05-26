## Context

Explore 结论：产品内缺少用户向说明层。`docs/`（14 篇）与 `README.md` 偏设计与开发者，`purpose.md` / `rules.md` 面向 LLM 而非人类新手。Web UI 导航目前固定为 Chat / Jobs / Timeline / Logs / Settings + Wiki 链接，无 Help 入口。

用户决策：
- 覆盖 Web UI、CLI、MCP 用户
- 第六个主导航项「帮助」
- 内容从 `docs/` 提炼，维护在 `web/src/content/help.{zh,en}.md`
- 语言跟随 `ui_language`
- 仅 `llmwiki serve` 后 Web UI 可见（embedded SPA，无独立文档站）

现有可复用能力：`MarkdownContent` + `wiki-prose`（Settings / ArchiveReviewCard 已用）、i18n 系统、`PageContainer` / `WorkbenchContentShell` 布局模式。

## Goals / Non-Goals

**Goals:**

- Workbench 新增 `/help` 路由与 Help 导航项
- 双语静态 Markdown 帮助文档，按 `ui_language` 切换
- 内容涵盖：核心理念、工作区结构、Wiki 类型目录、Web UI 各页用法、CLI 摘要、MCP RPC 接入、FAQ
- 使用与 Wiki 阅读器一致的 Markdown 渲染样式
- 左侧章节锚点导航，长文可扫读

**Non-Goals:**

- 不将帮助页写入 workspace `wiki/`（避免与用户知识混放）
- 不新增后端 API 或运行时从 `docs/` 动态读取
- 不做 onboarding wizard 或首次访问强制引导
- 不替代 `README.md` / `docs/` 的完整开发者文档
- 不在 Wiki Reader 内嵌帮助（Help 属于 Workbench）

## Decisions

### 1. 内容载体：构建时 import 的 Markdown 文件

**选择**: `web/src/content/help.zh.md` 与 `help.en.md`，在 `HelpPage` 中 `import ...?raw` 或通过 Vite 静态 import，按 `useI18n().lang` 选择。

**理由**: 与 embedded 单二进制一致；双语显式维护；实现时从 `docs/` 提炼后写入，避免运行时读 repo `docs/`。

**备选**: 服务端 API 读 `docs/` — 拒绝，增加部署路径依赖且 serve 时 workspace 未必含 repo docs。

### 2. 路由与导航

**选择**:

- `WorkbenchView` 扩展 `"help"`
- `workbenchViewHref("help")` → `/help`
- `getWorkbenchViewFromPath` 识别 `/help`
- `NAV_ITEMS` 在 Settings 前或后插入 `{ id: "help", labelKey: "nav.help" }`（建议 Settings 前：Chat, Jobs, Timeline, Logs, Help, Settings）

**理由**: 与现有 workbench 视图模式一致；URL 可 bookmark。

### 3. 页面布局

**选择**: `HelpPage` 使用 `PageContainer` + 两栏布局：

```
┌──────────────────────────────────────────────┐
│  AppHeaderBar (现有 Workbench 顶栏)            │
├──────────┬───────────────────────────────────┤
│ 章节目录  │  MarkdownContent (wiki-prose)    │
│ (sticky) │  可滚动正文                         │
└──────────┴───────────────────────────────────┘
```

章节目录从 Markdown h2/h3 提取（客户端 parse 或 hand-maintained TOC 数组）。v1 推荐 **hand-maintained TOC** 与 i18n key 对齐，避免中英文 heading slug 不一致。

**理由**: Settings 已是 card 列表；Help 长文需要 TOC；hand TOC 稳定且可测。

### 4. 内容大纲（提炼来源）

| 章节 | 要点 | 主要来源 |
|------|------|----------|
| 快速开始 | init → serve → Provider → 第一次 Archive | README Quick Start |
| 核心理念 | Wiki vs RAG；Ingest / Query / Lint | `docs/01-karpathy-core-concept.md` |
| 工作区结构 | raw / wiki / .llmwiki / purpose / rules | README + workspace-management spec |
| Wiki 如何组织 | 6 类 typed 目录 + overview/index/log | typed-wiki-organization + `docs/12-*` |
| Web UI 指南 | Chat、Jobs、Timeline、Logs、Settings、Wiki Reader | web-ui spec + README |
| CLI 参考 | init / serve / ingest / reindex / mcp 摘要表 | README CLI 章节 |
| MCP 接入 | RPC-first `/mcp`、`mcp-config`、工具概览 | README MCP 章节 |
| 常见问题 | 合并策略、reindex、PDF tier、语言设置 | README + ingest spec |

### 5. i18n 策略

**选择**: 导航标签 `nav.help` 走 i18n；正文整篇切换 `help.zh.md` / `help.en.md`（非逐段 key）。

**理由**: 长文档用 Markdown 维护效率更高；与 `doc_language` 无关，仅 `ui_language`。

### 6. 内容维护约定

**选择**: 实现时在 PR 描述或 `web/src/content/README.md`（可选）注明：用户向帮助改 `help.*.md`，设计变更同步回溯 `docs/` 对应章节。

**理由**: 满足「从 docs/ 提炼」而不强制 build 脚本耦合。

## Risks / Trade-offs

- **[Risk] help 与 docs/ 内容漂移** → 在 tasks 中要求对照 `docs/` 关键章节；重大产品变更时同步更新 help markdown
- **[Risk] 导航项增至 6 个，小屏拥挤** → 沿用现有 `flex` 导航；必要时后续改为 overflow menu（非本变更范围）
- **[Risk] 中英文 TOC slug 不一致** → hand-maintained TOC 按语言分文件或使用 language-specific anchor ids
- **[Risk] CLI/MCP 细节过时** → 帮助页写「摘要 + 指向 README 完整列表」而非复制全部 flags 表

## Migration Plan

1. 新增 content markdown、HelpPage、路由与导航
2. 更新 web-ui / help-page spec deltas
3. 新增/更新前端测试（`app-nav.test.tsx`、`wiki-routes.test.ts`、`help-page.test.tsx`）
4. `make build-web` 验证 embed
5. 无数据迁移；rollback 删除 Help 相关文件即可

## Open Questions

- Help 导航顺序：Settings 前还是后？→ **建议 Logs 与 Settings 之间**
- Wiki Reader header 是否也需要 Help 链接？→ v1 **否**，Workbench 专属；Wiki 可返回 Workbench 再进 Help
