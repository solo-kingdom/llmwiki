## Why

当前实现已完成核心骨架，但关键架构决策尚未在规范层固化：MCP 接入方式、单进程服务边界、业务真理数据与索引数据的边界、并发策略、以及首版 PDF/Office 支持策略仍可能在实现中出现偏移。现在需要把这些决策转化为可测试的需求约束，避免后续实现与最初目标冲突。

## What Changes

- 将 MCP 接入策略明确为：**首版不要求 Claude Desktop 无改造接入**，默认通过服务内 RPC 提供 MCP 功能。
- 将服务拓扑明确为：**单进程单服务**（项目代码层面），统一承载 HTTP API、Web UI、MCP RPC。
- 增加数据一致性硬约束：**业务真理数据必须落文件**；SQLite 仅存可重建衍生物，并允许缓存部分真理数据副本用于性能。
- 增加并发摄取约束：**跨文件并发、同页面串行**，引入页面级锁（path mutex）。
- 增加引用图更新约束：使用事务与幂等更新策略，确保高并发下一致性。
- 将首版 PDF/Office 能力明确为分层支持：优先本地解析与可选系统依赖，提供可观测降级路径，并定义后续增强计划。
- 明确 LLM 配置管理策略：优先 Web UI 配置，其次环境变量回退；超时参数可配置。

## Capabilities

### New Capabilities
- `single-process-service-topology`: 规范单进程单服务拓扑与组件边界（HTTP/Web/MCP RPC 同进程）。
- `mcp-rpc-access-model`: 规范 MCP 默认通过 RPC 暴露、首版不强制 Claude Desktop stdio 直连。
- `truth-data-persistence-boundary`: 规范真理数据必须文件化、SQLite 仅存可重建衍生物（允许缓存副本）。
- `ingest-concurrency-control`: 规范“跨文件并发、同页面串行”的并发策略与页面级锁约束。
- `reference-graph-transactional-update`: 规范引用图更新采用事务 + 幂等，确保并发一致性。
- `tiered-source-processing-v1`: 规范首版 PDF/Office 分层处理能力、可选系统依赖与降级行为。
- `llm-config-management`: 规范 LLM 配置来源优先级（Web UI > 环境变量）与可配置超时。

### Modified Capabilities

<!-- No existing capabilities in openspec/specs to modify -->

## Impact

- 影响 `internal/server`、`internal/mcp`、`internal/store`、`internal/engine`、`internal/ingest`、`internal/watcher`、`internal/llm` 相关实现。
- 影响配置与运行模式：移除“必须 stdio MCP 直连”的假设，强化 RPC MCP 端点。
- 影响数据模型与实现边界：文件系统与 SQLite 的职责划分需要在 reindex、ingest、watcher 中统一。
- 影响并发控制与事务策略：页面级锁与引用图更新事务需要贯穿写入路径。
- 影响源文件处理链路：首版 PDF/Office 支持策略与依赖检测、降级提示将进入 API/UI/日志语义。
