## Context

当前 `llmwiki serve` 在单进程内同时提供 Web/API、watcher 和 `/mcp` JSON-RPC HTTP POST 入口。`/mcp` 已支持 `initialize`、`tools/list`、`tools/call`，并注册 `guide/search/read/write/delete/ping` 等工具，但远程 agent 接入时仍存在几个模糊点：无认证运行时可能直接暴露写入工具、工具能力未区分只读/写入、远程配置片段缺少认证 header 和访问模型说明、调用日志只记录工具名而缺少远程调用诊断信息。

本变更把现有 MCP Server 作为主要集成面继续演进，不引入新的服务进程，也不把外部 MCP Client 能力纳入范围。

## Goals / Non-Goals

**Goals:**

- 让远程 agent 可以通过 HTTP JSON-RPC 稳定调用 llmwiki MCP Server。
- 远程场景默认安全：认证必需、只读默认、写入显式开启。
- 保持 `/mcp` 与 Web/API 共用同一 workspace、SQLite index、file indexer 和 activity log。
- 提供 agent 可直接使用的 `mcp-config` 输出。
- 为远程 tool-call 提供足够诊断信息，同时避免泄露 token、Authorization header 或大段参数内容。

**Non-Goals:**

- 不实现新的外部 MCP Client 调用能力。
- 不重构 local/stdio MCP 模式；现有 `llmwiki mcp` 可继续作为 legacy local mode。
- 不引入多用户、多租户或 OAuth 权限系统。
- 不默认开放写入和删除工具给远程 agent。
- 不强制引入 SSE/streamable HTTP 长连接；本次以 HTTP POST JSON-RPC 为稳定目标。

## Decisions

### D1: 继续采用 `/mcp` HTTP POST JSON-RPC 作为远程入口

**决策**: 保持现有 `/mcp` endpoint，完善 JSON-RPC 请求校验、Content-Type、错误响应和初始化元信息。`initialize` 返回的 `_meta` 明确 `transport=http-post-jsonrpc`、`accessModel=remote-rpc`、`auth=required-when-remote`、`defaultToolPolicy=readonly`。

**理由**: 当前代码和文档已经围绕 RPC-first MCP 建立，继续强化现有入口的兼容成本最低，也符合“暂时不用考虑 local 调用”的约束。

**备选**: 新增 `/api/v1/mcp` 或 SSE endpoint。暂不采用，因为会增加客户端配置和路由兼容成本；后续如果需要 streamable HTTP，可作为独立增强。

### D2: 远程 MCP 安全以服务级 token 为第一阶段边界

**决策**: 复用 `llmwiki serve --token` 的 Bearer token 认证作为远程 MCP 第一阶段安全机制。服务绑定非 loopback 地址或生成远程 MCP 配置时，必须显式带 token 或提示/失败，避免无认证暴露 `/mcp`。

**理由**: 项目已有可选 token 中间件，复用它能降低复杂度并让 Web/API 与 MCP 安全模型一致。

**备选**: 单独新增 MCP token store 或 per-agent token。暂不采用，因当前没有用户/agent 身份模型；可以在后续审计需求明确后扩展。

### D3: 远程默认只读工具集，写工具显式启用

**决策**: 远程 MCP 默认工具列表只包含 `guide`、`search`、`read`、`references`、`lint`、`ping` 等只读/诊断工具。`write`、`delete` 等会修改 workspace 的工具需要通过显式配置或启动参数开启，并在 `tools/list` 中只在启用后出现。

**理由**: 远程 agent 的误操作半径大于本机交互，默认只读能最大限度保护文件系统这个权威数据源。

**备选**: 保持现有 6 个工具全量开放。否决，因为现有列表包含写入/删除能力，和远程安全预期冲突。

### D4: 工具实现复用本地只读执行器并收敛重复定义

**决策**: MCP Server 的只读工具 schema 和执行逻辑优先复用 `internal/mcp/local_tools.go` 的内置只读工具定义与执行函数，减少 `tools.go` 与 local tool loop 之间的重复。远程 Server 只负责注册工具、记录审计、处理策略。

**理由**: 当前 `tools.go` 与 `local_tools.go` 已存在相近的 `search/read` 定义，继续复制容易导致 schema 与行为不一致。

**备选**: 保持两套工具定义。短期实现简单，但会让远程 MCP 和内部 tool loop 行为继续漂移。

### D5: 审计日志记录摘要而非完整参数

**决策**: 每次远程 `tools/call` 记录 `category=mcp` 日志，包含 tool 名称、远程地址摘要、agent/client 名称（如能从 header 或 initialize params 获取）、耗时、状态和错误类型。日志不得记录 Authorization、token、headers 原文或完整 tool arguments。

**理由**: 远程集成需要知道“谁调用了什么、是否失败、为什么失败”，但工具参数可能包含私密知识库内容或凭证。

**备选**: 仅保留现有工具名日志。诊断信息不足，无法区分认证失败、参数错误、工具执行错误或 agent 配置错误。

### D6: `mcp-config` 生成远程 agent 友好的配置片段

**决策**: `llmwiki mcp-config` 输出 endpoint、transport、headers、workspace、readonly 默认策略和安全提示。对 `--bind 0.0.0.0` 或非本机 host 的远程配置，若未提供 token，应返回明确错误或警告并拒绝生成含无认证远程地址的配置。

**理由**: 远程 agent 集成的第一步通常是复制配置片段，配置输出必须体现安全默认值。

**备选**: 只输出 URL。信息不足，容易导致 agent 连接失败或无认证暴露。

## Risks / Trade-offs

- **远程 token 复用 Web/API token，权限粒度较粗** → 第一阶段通过只读默认工具集降低风险；后续可引入 per-agent token 和 scope。
- **只读默认可能让已有依赖写工具的 MCP 用户感到行为变化** → 仅对远程安全策略明确收紧，并在配置、帮助和初始化元信息中说明如何显式启用写工具。
- **HTTP POST JSON-RPC 不覆盖所有 MCP 客户端偏好的 streamable transport** → 本次先稳定 RPC-first 入口；后续根据真实 agent 兼容性追加 streamable HTTP。
- **日志如果记录过多会泄露知识内容** → 只记录摘要、状态和错误类型，不记录完整参数或返回内容。

## Migration Plan

1. 保持 `/mcp` endpoint 路径不变，现有 RPC 客户端无需改 URL。
2. 默认工具策略变为远程只读；需要写入能力的部署显式开启并承担安全责任。
3. 更新 `mcp-config` 和 Help 文档，引导远程部署使用 `--token`、HTTPS/反向代理和只读默认。
4. 回滚时可保留旧 `/mcp` handler 行为，但不建议在远程无认证环境回退到全工具开放。

## Open Questions

- 写工具显式开启使用 CLI flag、环境变量，还是 app_config 配置？建议实现前优先选择 CLI flag，保持部署级安全边界清晰。
- 是否需要记录 agent identity？第一阶段可从 `User-Agent`、`MCP-Client-Name` 或 initialize params 中尽力提取，不作为认证身份。
