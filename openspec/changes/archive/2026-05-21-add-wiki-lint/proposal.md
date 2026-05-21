## Why

Karpathy 将 Lint 定义为 LLM Wiki 三大核心操作之一，但本项目仅有 `dataaudit.go`（数据结构审计），缺少 Wiki 内容健康检查。随着 ingest 测试进行，死链、孤立页、frontmatter 不一致等问题会累积且不可见。Web UI + MCP 双入口需要统一的 lint 暴露面。

## What Changes

- 新增 `engine/lint.go`：机械验证（L1 + L3）
- 新增 `llmwiki lint` CLI 命令
- 新增 `GET /api/v1/lint` HTTP 端点（Web UI 可消费）
- MCP `search(mode="lint")` 或独立 lint 工具
- frontmatter type↔目录一致性验证
- `wiki/log.md` 契约验证（仅追加、日期非递减）

## Scope

### In Scope (L1 + L3)

- 死链检测（`[[wikilink]]` 目标不存在）
- 孤立页面检测（wiki 页无入链，排除 index/log/overview）
- frontmatter 必需字段 + type↔目录匹配
- log.md 格式与 append-only 契约
- Wiki 统计摘要（页数、源数、最后更新）

### Out of Scope (留给后续)

- L2：陈旧声明、缺失交叉引用
- L4：LLM 矛盾检测
- Required Sections 验证（留给 templates change）
- index 过时检测（`--check-index`）

## Capabilities

### New Capabilities

- `wiki-lint`: Wiki 内容健康检查引擎与多入口暴露

### Modified Capabilities

- `cli-interface`: 新增 `lint` 子命令
- `mcp-server`: lint 结果查询
- `search-engine` 或新 API spec: HTTP lint 端点

## Dependencies

- 建议在 `fix-workspace-scaffold-zh` 之后（依赖完整目录约定）
- 与 `add-cjk-search` 可并行
