## Context

当前仓库已实现第一轮代码骨架（Go 单仓、SQLite schema、engine/store/watcher/mcp/http 框架），但需求决策在实现中存在偏移风险：

- MCP 接入方式：实现中仍保留 stdio 思维，而产品决策已转为“单进程单服务 + RPC MCP”。
- 数据边界：需要把“业务真理数据必须落文件，DB 仅衍生”从原则升级为硬约束。
- 并发策略：允许并发摄取，但缺少明确的“跨文件并发、同页面串行”调度约束。
- 引用图一致性：需要明确事务与幂等写入策略，避免并发更新下图不一致。
- 首版源文件处理：已决定首版支持 PDF/Office，但方式应为分层能力（可选系统依赖、可降级）。
- LLM 配置管理：已决定优先 Web UI 配置，不应绑在启动命令参数上。

这次变更的目标是固化上述决策，形成可测试的规范，指导后续实现与验收。

## Goals / Non-Goals

**Goals:**

1. 固化服务拓扑：单进程单服务，HTTP/Web/MCP RPC 同进程。
2. 固化 MCP 接入模型：首版默认 RPC MCP，不要求 Claude Desktop 无改造直连。
3. 固化数据真理边界：真理数据文件化，DB 仅衍生 + 可选缓存。
4. 固化并发与一致性策略：跨文件并发、同页面串行；引用图事务 + 幂等更新。
5. 固化首版 PDF/Office 支持策略：分层能力、可选系统依赖、可观测降级。
6. 固化 LLM 配置来源与运行参数：Web UI 优先，环境变量回退，超时可配置。

**Non-Goals:**

1. 首版不要求 Claude Desktop 原生 stdio MCP 无改造接入。
2. 首版不引入 MCP proxy tool。
3. 首版不承诺零系统依赖（允许 PDF/Office 处理使用可选系统依赖）。
4. 本变更不定义具体 provider UI 细节（仅定义配置来源与优先级）。
5. 本变更不替代已有功能规格，只约束架构决策落地。

## Decisions

### 1) 单进程单服务拓扑

**Decision:** 统一通过 `llmwiki serve` 启动单进程服务，进程内同时承载：

- HTTP API
- Web UI 静态资源服务
- MCP RPC 端点
- 文件监视器与索引更新任务

**Why:**

- 消除多进程共享 SQLite 的写冲突与状态漂移。
- 统一依赖注入（store/engine/lock manager）避免重复初始化。
- 降低部署与运维复杂度。

**Alternatives considered:**

- 双进程（serve + mcp stdio）：被拒绝，状态一致性成本高。
- 单进程 + 外置 mcp proxy：首版拒绝，推迟。

### 2) MCP 默认通过 RPC 暴露（非 stdio）

**Decision:** 首版 MCP 功能通过 RPC 端点暴露，作为服务内能力；不强制 Claude Desktop 无改造直连。

**Why:**

- 与单进程架构一致。
- 与“先做项目服务能力，再做生态接入适配”策略一致。

**Alternatives considered:**

- 首版即支持 Claude Desktop stdio：被拒绝（引入额外兼容成本）。

### 3) 真理数据与索引边界

**Decision:**

- 真理数据必须持久化到文件系统（markdown/frontmatter/source files/config files）。
- SQLite 仅存可重建衍生数据（chunks、FTS、references、状态索引），可缓存部分真理数据副本用于性能。
- `reindex` 必须可从文件系统恢复核心业务语义（含 frontmatter 元数据与引用关系）。

**Why:**

- 符合“文件即真理”目标。
- 支持可审计、可迁移、可恢复。

**Alternatives considered:**

- 真理仅存 DB：被拒绝（恢复能力差，违背初始目标）。

### 4) 并发摄取策略

**Decision:**

- 允许跨文件并发摄取。
- 同页面更新必须串行化（page path mutex）。
- 写路径统一走锁管理，防止覆盖写与丢更新。

**Why:**

- 在吞吐与一致性之间平衡。
- 页面是最小一致性单元，按路径加锁成本可控。

### 5) 引用图更新策略

**Decision:** 引用图更新采用“事务 + 幂等 upsert”策略：

1. 在事务中执行 delete old refs + parse + upsert new refs。
2. 使用唯一约束 `(source, target, type)` 实现幂等。
3. 失败回滚，避免部分更新。

**Why:**

- 并发下保证图一致性。
- 重试安全，便于任务恢复。

### 6) 首版 PDF/Office 分层能力

**Decision:** 首版支持 PDF/Office，但采用分层能力：

- Layer A: 内建可用解析能力（若有）
- Layer B: 可选系统依赖（如 libreoffice/pdftotext 等）
- Layer C: 降级路径（标记可读性限制、提示用户补齐依赖）

并在 API/UI/日志中暴露当前处理层级与降级原因。

**Why:**

- 满足“首版支持”目标，同时保持可落地与可运维。

### 7) LLM 配置来源与优先级

**Decision:**

- 配置主入口为 Web UI（支持多 provider 扩展）。
- 环境变量作为回退机制。
- 超时参数可配置（请求超时、流式空闲超时等）。

**Why:**

- 多 provider 场景下 CLI 参数不可维护。
- UI 配置更易扩展与验证。

## Risks / Trade-offs

- **[Risk] RPC MCP 与外部工具生态兼容性不足（首版不做 Claude stdio 无改造）** → **Mitigation:** 明确首版边界，后续通过独立接入变更补齐生态适配。
- **[Risk] PDF/Office 依赖可选导致环境差异** → **Mitigation:** 启动时依赖探测 + 处理层级暴露 + UI 明确降级提示。
- **[Risk] 并发摄取下锁粒度不当影响吞吐** → **Mitigation:** 采用页面级锁并埋点锁等待时间，按指标优化。
- **[Risk] 事务范围过大影响写性能** → **Mitigation:** 引用图事务仅覆盖必要语句，正文写入与图更新边界清晰。
- **[Risk] “DB 可缓存真理副本”被滥用为真理源** → **Mitigation:** 文档与代码层明确“文件优先读取与恢复”，缓存仅作为性能优化。

## Migration Plan

1. 在现有代码中新增/替换 MCP 暴露方式为服务内 RPC 端点，保留现有骨架但不再以 stdio 为默认路径。
2. 引入统一锁管理器（path mutex），接入 ingest/write 路径。
3. 引用图写路径切换为事务 + 幂等 upsert。
4. 在 source processing 管线中增加能力分层与依赖探测，补充降级返回语义。
5. 增加配置读取优先级：Web UI 配置文件优先，环境变量回退，超时参数可配置。
6. 回归验证：并发摄取、reindex 恢复、PDF/Office 分层行为、MCP RPC 可用性。

**Rollback strategy:**

- MCP：保留兼容开关，可临时回退到现有本地调用路径。
- 引用图：事务改造失败可回退到单线程更新（功能降级但保证可用）。
- PDF/Office：依赖不可用时自动降级，不阻断主流程。

## Open Questions

1. MCP RPC 端点采用何种传输风格（纯 JSON-RPC POST / SSE / 两者）作为首版默认？
2. “可缓存部分真理数据”的白名单边界是什么（例如 frontmatter 镜像是否允许）？
3. PDF/Office Layer A 的最小内建能力定义（哪些格式必须达到“可用”）？
4. Web UI 配置持久化路径与加密策略（尤其 API Key 存储）采用何级别保护？
