## Why

LLM Wiki 已有完整的 ingest → review → wiki 工作流与丰富的设计文档（`docs/`、`README.md`），但 Web UI 内缺少面向用户的产品说明入口。新用户难以理解「编译式 Wiki」与 RAG 的区别、工作区目录约定、各功能区职责，以及 CLI/MCP 等进阶接入方式，增加上手成本。

## What Changes

- **新增** Workbench 第六个全局导航项「帮助」（Help），路由 `/help`
- **新增** `HelpPage` 页面：以 `wiki-prose` 渲染结构化 Markdown 帮助文档，左侧锚点目录 + 右侧正文
- **新增** 双语帮助内容文件（`web/src/content/help.zh.md`、`help.en.md`），从 `docs/` 与 `README.md` **提炼**用户向说明（非照搬开发文档）
- **覆盖** Web UI 使用指南、Wiki 设计理念、工作区结构、CLI 命令摘要、MCP RPC 接入说明
- **语言** 跟随 Settings 中的 `ui_language`（`zh` / `en`）切换帮助正文
- **可见性** 仅在 `llmwiki serve` 启动后的 Web UI 内提供；不写入 workspace wiki、不依赖 init scaffold

## Capabilities

### New Capabilities

- `help-page`：定义帮助页内容结构、双语切换、信息章节（理念、工作区、Web UI、CLI、MCP、FAQ）及 Markdown 渲染要求

### Modified Capabilities

- `web-ui`：Workbench 全局导航增加 Help 条目；新增 `/help` 路由与 Help 页面布局要求

## Impact

- **前端**: `HelpPage.tsx`、帮助 Markdown 内容文件、`wiki-routes.ts`（`help` view + `/help` href）、`WorkbenchLayout.tsx`（导航项）、i18n（`nav.help` 等）、测试（路由与页面渲染）
- **后端**: 无 API 变更（静态内容随前端 embed）
- **文档**: 实现时从 `docs/01-karpathy-core-concept.md`、`docs/12-wiki-directory-organization.md`、`README.md` 等提炼并维护 `web/src/content/help.*.md`；可选在 `docs/` 增加「用户指南来源索引」说明维护关系
- **Breaking**: 无
