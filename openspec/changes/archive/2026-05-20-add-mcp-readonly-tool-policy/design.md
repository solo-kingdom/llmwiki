## Context

系统当前具备 MCP Server 能力（`/mcp`），但缺少 MCP Client 能力。`Pipeline` 在 `analysis/generation` 阶段仅使用纯文本流式回复，不支持工具调用循环。Settings API 使用 `app_config` 键值存储，适合先落地 JSON 高级模式配置而不引入新表结构。

用户已明确以下约束：

- 配置作用域为全局（非会话级）。
- 密钥与配置沿用 `app_config`。
- 前端交互采用 JSON 高级模式。
- 失败策略为自动降级。
- Job 允许模型自动发起 MCP tool-call。
- 默认仅允许只读工具（如 `search/read`）。

## Goals / Non-Goals

**Goals:**

- 提供全局 MCP 服务器配置，并支持 SSE 等常见协议。
- 在 Job 中实现模型自动 tool-call 闭环（请求工具、执行工具、回填结果、继续推理）。
- 建立默认只读工具策略，防止未授权写入。
- 在 MCP 不可用时自动降级，不阻断 Job 主链路。
- 提供足够的可观测性（事件、日志、降级标记）。

**Non-Goals:**

- 本次不重构 Settings 存储为独立关系表。
- 本次不默认开放写操作工具。
- 本次不要求会话级/用户级差异化 MCP 配置。
- 本次不替换现有 MCP Server 对外能力。

## Decisions

### D1: 配置模型采用单键 JSON（app_config）

**决策**: 在 `app_config` 中新增 `mcp_servers_json`，承载完整 MCP 配置文档。

建议结构：

```json
{
  "version": 1,
  "servers": [
    {
      "id": "context7",
      "name": "Context7",
      "enabled": true,
      "transport": "sse",
      "url": "https://example.com/sse",
      "headers": {},
      "timeout_ms": 15000,
      "retry": { "max": 1, "backoff_ms": 500 },
      "scope": { "job": true, "chat": false },
      "allowed_tools": ["search", "read"]
    }
  ],
  "defaults": {
    "readonly_only": true,
    "fallback_mode": "local_only"
  }
}
```

**理由**:

- 与现有 Settings 架构一致，变更成本最低。
- JSON 高级模式可覆盖复杂协议字段，避免短期内频繁改 schema。

### D2: Runtime 架构分层（Registry + Adapter + Router）

**决策**: 新增 MCP Client 运行时三层结构：

- `Registry`: 加载/缓存配置，按 scope 与 enabled 过滤服务器。
- `Transport Adapter`: 按协议发起通信（`sse`、`streamable-http`、`stdio`）。
- `Tool Router`: 统一 `tools/list`、`tools/call`，处理超时、重试、故障切换。

**理由**:

- 解耦配置、协议和业务调用，有利于扩展新协议。
- 便于在 Job 和后续 Chat 场景复用。

### D3: Job 引入 Tool-Call Loop（默认启用）

**决策**: 在 `ingest/pipeline` 的 `analyze` 与 `generate` 阶段引入 `runWithTools(...)` 执行器：

1. 获取可用工具清单（受权限策略过滤）。
2. 调用模型，允许其返回工具调用请求。
3. 执行 MCP 工具并回填结果消息。
4. 重复循环直到模型返回最终文本或触发轮次上限。

建议限制：

- `max_rounds`: 6
- `max_tool_calls_per_round`: 4
- `tool_timeout_ms`: 来源于 server 配置（带默认值）

**理由**:

- 满足 Job 自动 tool-call 目标。
- 通过上限控制防止循环失控。

### D4: 默认只读工具白名单（强约束）

**决策**: 全局默认 `readonly_only=true`，若未显式声明 `allowed_tools`，则仅允许 `search`、`read`。写类工具（`create/edit/append/delete`）默认禁止。

**理由**:

- 默认最小权限，降低误操作风险。
- 与“先可用、后放开”策略一致。

### D5: 自动降级策略（不中断 Job）

**决策**: MCP 调用失败采用分级降级：

1. 当前 server 重试（按 `retry.max`）。
2. 切换下一个 enabled server。
3. 全部失败后切换 `local_only`，继续 Job。

`local_only` 语义：禁用工具调用，仅保留模型纯文本推理路径。

**理由**:

- 保证 Job 稳定性优先，避免外部 MCP 波动导致任务整体失败。

### D6: 可观测性与诊断

**决策**: 在 `ingest_job_events` 与 `activity_logs` 记录 MCP 关键事件：

- `mcp_tools_list_started|failed|completed`
- `mcp_tool_call_started|failed|completed`
- `mcp_degraded`
- `mcp_fallback_local_only`

日志中必须脱敏 headers/token。

**理由**:

- 便于定位是配置错误、协议错误、认证失败还是工具本身失败。

## Risks / Trade-offs

- **[JSON 配置复杂度]** 高级模式灵活但易写错，需要强校验与错误提示。
- **[协议差异]** SSE 与 streamable-http 行为差异较大，adapter 层需处理边界。
- **[模型兼容性]** 部分模型虽标记支持 `tool_call` 但行为不稳定，需要在运行时兜底。
- **[降级掩盖问题]** 自动降级会减少失败，但可能隐藏 MCP 长期异常；需通过日志与告警补偿。
- **[权限误配置]** 若误开放写工具会增加风险，默认只读与显式白名单必须严格执行。
