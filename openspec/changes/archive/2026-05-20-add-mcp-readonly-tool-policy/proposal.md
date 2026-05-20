## Why

当前系统仅支持作为 MCP Server 对外提供工具，不支持在应用内部配置并调用外部 MCP 服务。随着 Job 自动化场景增加，模型在分析与生成阶段需要通过 MCP 工具动态补充上下文（例如检索、读取），但缺少统一配置、连接管理、权限边界和失败降级策略。

本变更将引入全局 MCP 客户端配置能力，允许在 Settings 中以 JSON 高级模式配置 MCP 服务器（含 SSE 等常见协议），并让 Job 流程支持模型自动 tool-call。在默认安全策略上，仅允许只读工具，避免写操作工具在未授权情况下影响工作区内容。

## What Changes

- 在设置中新增全局 `mcp_servers_json` 配置（存储于 `app_config`），采用 JSON 高级模式管理 MCP 服务器列表、协议、认证头、超时和重试策略。
- 新增 MCP 客户端运行时（registry + transport adapters），支持常见协议，至少覆盖 `sse` 与 `streamable-http`，并保留 `stdio` 接入位。
- 在 Job 执行链路中引入模型工具循环（tool-call loop），让模型可自动发起 MCP 工具调用并将结果回填后继续推理。
- 新增默认工具权限策略：仅允许只读工具（如 `search`、`read`）；写操作工具需显式白名单开启。
- 新增自动降级策略：当 MCP 调用失败时按服务器顺序重试/切换，最终降级为无工具模式继续完成 Job，不阻断主流程。
- 扩展日志与事件记录，明确标记工具调用、失败原因、降级路径及最终执行模式。

## Capabilities

### Modified Capabilities

- `web-ui`: Settings 页面支持 MCP 服务器 JSON 高级配置与校验反馈。
- `ingest-pipeline`: Job 阶段支持模型自动 tool-call，并在失败时自动降级。
- `ingest-job-events`: 增强 MCP 调用与降级可观测性。
- `llm-integration`: 扩展模型调用执行器，支持工具循环与工具结果回填。
- `mcp-server`: 在保留现有 MCP Server 能力的同时，新增 MCP Client 侧的协议与调用管理能力。

## Impact

- **后端配置与 API**: `internal/api/settings.go`、`internal/store/sqlite/app_config.go`
- **MCP 运行时**: `internal/mcp/`（新增 client/transport/registry 相关模块）
- **LLM 与 Job 链路**: `internal/llm/`、`internal/ingest/pipeline.go`、`internal/ingest/processor.go`
- **前端设置页**: `web/src/components/SettingsPage.tsx`、`web/src/types.ts`、`web/src/lib/api.ts`
- **测试**: settings API 校验、MCP transport 适配、tool-call loop、只读白名单和降级路径测试
