## Context

本项目基于 Andrej Karpathy 的 [LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，参考了两个已有实现（lcasastorian/llmwiki 和 nashsu/llm_wiki）的架构和数据模型。目标是创建一个 Go 单二进制工具，同时支持 MCP RPC（给 LLM Agent）、HTTP API/Web UI（给人）、CLI（给人/LLM）三种交互入口，并具备远程服务能力。

**约束**：
- 所有用户数据以明文存储在文件中（Markdown + YAML frontmatter），SQLite 仅存可重建衍生数据（chunks、FTS、references），可缓存真理数据副本但不可作为权威源
- 单进程单服务部署（`llmwiki serve` 内含 HTTP + Web + MCP RPC + Watcher），Go 后端 + 内嵌 React 前端
- 删除 SQLite 后可从文件系统完全重建索引和数据（reindex）
- 支持 OpenAI/Anthropic 兼容的 LLM API（内置 streaming client），配置通过 Web UI 管理
- 首版支持 PDF/Office，采用分层能力（tiered capability）策略
- 并发摄取允许跨文件并行、同页面串行（path mutex）；引用图更新采用事务 + 幂等 upsert

> **注意**: 详细的架构约束决策已固化在 `v1-architecture-constraints` 变更中，本文档保持与其一致。

## Goals / Non-Goals

**Goals:**
1. 实现 Karpathy LLM Wiki 的核心功能：三层入口、两步骤摄取、引用图、全文搜索、文件监视
2. 文件即真理的存储架构：删 DB 可无损恢复，DB 仅存衍生数据
3. 单进程单服务 + 远程服务能力（HTTP/Web/MCP RPC 同进程）
4. MCP RPC 协议（HTTP POST JSON-RPC 2.0），6 个工具完整可用；首版不要求 Claude Desktop stdio 无改造直连
5. 嵌入式 Web UI（React/Vite/TypeScript），含 LLM 配置设置页
6. 首版支持 PDF/Office 源文件（分层能力）
7. 并发摄取控制：跨文件并发、同页面串行；引用图事务 + 幂等更新

**Non-Goals:**
- 首版不支持向量搜索或 LanceDB
- 首版不支持多用户/多租户（单一工作区 + 可选 token）
- 首版不支持知识图谱可视化（Louvain 社区发现等）
- 首版不支持 Deep Research（Web 搜索→自动摄入）
- 首版不支持 Chrome Extension Web Clipper
- 首版不要求 Claude Desktop stdio MCP 无改造直连（RPC-first，非 stdio-first）
- 首版不支持 MCP proxy tool
- 首版不支持 Git 集成或跨设备同步

## Decisions

### D1: Go 后端架构 — 单进程单服务

**选择**: 单一 Go binary，`chi` 做 HTTP 路由，`cobra` 做 CLI，`fsnotify` 做文件监视。`llmwiki serve` 在单一进程内启动 HTTP API + Web UI + MCP RPC + 文件监视 + 后台索引。

**考虑的替代方案**:
- Python (FastAPI): 放弃，不符合"单二进制"目标，部署沉重
- Rust (Tauri): 放弃，桌面 App 定位，不适合远程服务
- 双进程（serve + mcp stdio）: 放弃，多进程共享 SQLite 的写冲突与状态漂移成本高

**理由**: Go 的并发模型天然适合同时运行 HTTP server、文件监视器、MCP RPC handler。统一依赖注入（store/engine/lock manager）避免重复初始化。消除 SQLite 并发写问题。

### D2: SQLite 驱动

**选择**: `modernc.org/sqlite`（纯 Go）为首选，若 FTS5 有问题则切换到 `mattn/go-sqlite3`

**考虑的替代方案**: `mattn/go-sqlite3`（需 CGO）

**理由**: 纯 Go 避免 CGO 交叉编译痛点。`modernc.org/sqlite` 是 SQLite 的 Go 翻译版本，无需 C 工具链。

### D3: 文件即真理的存储架构

**选择**: 所有用户数据以明文 Markdown（含 YAML frontmatter）存储在 `wiki/` 目录，SQLite 仅索引 `documents`、`document_chunks`、`document_references` 等可重建衍生数据。DB 可缓存部分真理数据副本用于查询性能，但缓存不可作为权威源——文件系统是一致性校验和重建的唯一依据。

**理由**: 
- 与 Obsidian 兼容，用户可直接用 Obsidian 浏览 Wiki
- 版本控制友好（整个 workspace 就是一个 git repo）
- 删 DB 可重索引恢复，数据不丢失
- lcasastorian 已验证此模式可行，但其 `reindex` 有 gap（不回填 frontmatter），我们修复
- 缓存真理副本可避免频繁读文件，但必须在文件-缓存不一致时以文件为准

### D4: 两步骤摄取 pipeline

**选择**: 分析（Step 1）→ 生成（Step 2）→ 文件写入（Step 3），类似 nashsu/llm_wiki

**理由**: nashsu 验证了两次 LLM 调用比单次调用质量显著更好。分析阶段给 LLM 提供结构化思考空间，生成阶段聚焦文件产出。

### D5: 引用图解析引擎

**选择**: 正则解析脚注 `[^N]: file, p.3` 和 wiki 链接 `[text](path)`，三层 fallback 匹配目标文档

**理由**: lcasastorian 的实现已验证。正则简单可靠，三层匹配覆盖了文件名变体、无扩展名、相对路径等常见场景。`UNIQUE(source, target, type)` 约束避免重复边。

### D6: MCP JSON-RPC 实现 — RPC-first

**选择**: 自建轻量 JSON-RPC 2.0，作为 HTTP POST 端点（`/mcp`）暴露在 `llmwiki serve` 服务内。支持 `initialize` / `tools/list` / `tools/call` 三个核心方法。首版不要求 Claude Desktop stdio 无改造直连。

**考虑的替代方案**: 
- 使用 Go 的第三方 MCP 库（如 mark3labs/mcp-go）
- 首版实现 stdio transport 供 Claude Desktop 直连

**理由**: MCP 协议本身简单（JSON-RPC + 几个方法），自建避免外部依赖不稳定。RPC-first 与单进程架构一致。后期可评估第三方库成熟度和 Claude Desktop 生态适配需求。

### D7: 前端 UI 框架

**选择**: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui

**考虑的替代方案**: Ant Design, MUI, 纯 Tailwind + Headless UI

**理由**: shadcn/ui 组件 Tree-shakeable，构建产物小（利于 Go embed），nashsu 已验证此组合。

### D8: 并发摄取策略

**选择**: 跨文件并发、同页面串行。引入页面级 mutex（keyed by normalized page path），写路径统一走锁管理。

**理由**: 在吞吐与一致性之间平衡。页面是最小一致性单元，按路径加锁成本可控。防止覆盖写与丢更新。

### D9: 引用图事务性更新

**选择**: 引用图更新采用"事务 + 幂等 upsert"策略：在事务中执行 delete old refs → parse → upsert new refs。使用唯一约束 `(source, target, type)` 实现幂等。失败回滚。

**理由**: 并发下保证图一致性。重试安全，便于任务恢复。

### D10: 首版 PDF/Office 分层能力

**选择**: 分层处理：Layer A（内建可用解析）→ Layer B（可选系统依赖如 pdftotext/LibreOffice）→ Layer C（降级路径：标记可读性限制、提示用户补齐依赖）。处理层级与降级原因在 API/UI/日志中暴露。

**理由**: 满足"首版支持 PDF/Office"目标，同时保持可落地与可运维。

### D11: LLM 配置管理

**选择**: 配置主入口为 Web UI（支持多 provider），存储在 `.llmwiki/config.json`。环境变量作为回退机制。超时参数可配置（请求超时、流式空闲超时等）。不使用 CLI flags 管理 provider 配置。

**理由**: 多 provider 场景下 CLI 参数不可维护。UI 配置更易扩展与验证。

## Risks / Trade-offs

- **[风险] Go 生态 PDF 提取不成熟** → **缓解**: 首版采用分层能力策略——内建解析优先，可选系统依赖补充，不可用时降级并暴露状态
- **[风险] FTS5 中文分词效果差** → **缓解**: 接入 CJK bigram 分词（参考 nashsu 的 TypeScript 实现逻辑翻译为 Go），或使用 `unicode61` tokenizer 的 trigram
- **[风险] 引用图全量替换的短暂不一致** → **缓解**: 在 SQLite 事务中执行先删后写 + 幂等 upsert，保证原子性
- **[风险] 文件监视器跨平台差异（Linux inotify 丢事件）** → **缓解**: Linux 下 10 秒定期重扫描，macOS/Windows 较可靠
- **[风险] LLM 调用成本（每次摄取 15K+ tokens）** → **缓解**: SHA256 增量缓存，未变文件跳过。temperature=0.1 降低随机性，减少 token 浪费
- **[风险] 嵌入 SPA 的 client-side routing** → **缓解**: Go HTTP handler 把非 `/api/` 路径 fallback 到 `index.html`
- **[风险] RPC MCP 与外部工具生态兼容性不足** → **缓解**: 明确首版 RPC-first 边界，后续通过独立接入变更补齐 Claude Desktop stdio 适配
- **[风险] 并发摄取下锁粒度不当影响吞吐** → **缓解**: 采用页面级锁并埋点锁等待时间，按指标优化
- **[风险] "DB 可缓存真理副本"被滥用为权威源** → **缓解**: 文档与代码层明确"文件优先读取与恢复"，缓存仅作为性能优化

## Open Questions

1. `modernc.org/sqlite` 的 FTS5 支持程度？需实际验证
2. 前端构建产物 (dist/) 大小？影响 Go binary 体积
3. ~~LLM streaming client 的超时策略：30 分钟 for reasoning models? 是否需要可配置？~~ → **已解决**: 超时参数通过 Web UI 配置，可配置
4. 摄取队列：首版用内存队列还是 SQLite-backed job queue？
5. ~~源文件处理：是否需要引入外部工具 (opendataloader, LibreOffice) 还是首版仅支持文本？~~ → **已解决**: 首版采用分层能力策略（内建 → 可选系统依赖 → 降级）
6. MCP RPC 端点传输风格：纯 JSON-RPC POST / SSE / 两者作为首版默认？
7. "可缓存部分真理数据"的白名单边界？
8. PDF/Office Layer A 的最小内建能力定义？
9. Web UI 配置持久化路径与 API Key 存储加密策略？
