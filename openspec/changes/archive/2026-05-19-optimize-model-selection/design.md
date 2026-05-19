## Context

llmwiki 是一个单进程 Go 应用（嵌入式 React SPA + SQLite），当前 LLM 配置存在双轨问题：前端 `SettingsConfig` 纯内存不持久化，后端 `ConfigManager` 使用 `.llmwiki/config.json` 文件。两套系统互不通信，导致前端改了 provider 后端根本不知道。此外只有一个全局 API Key，所有 session 共用一个 LLM Client，provider/model 列表硬编码为 4 个选项。

## Goals / Non-Goals

**Goals:**
- Per-provider API Key 存储，支持同时配置多个 provider 的密钥
- 动态 provider/model 列表，通过 models.dev 获取元数据，内置快照兜底
- 每个 session 独立配置 provider 和 model
- "最近使用"全局配置，新建 session 自动继承
- 多 session 侧边栏（ChatGPT 风格）
- 所有配置统一持久化到 SQLite
- 未配置 provider/model 或缺少 API Key 时，输入框禁用

**Non-Goals:**
- 不做 API Key 加密存储（接受明文存储在本地 SQLite，与当前 `.llmwiki/config.json` 安全级别一致）
- 不做 provider 的 OAuth/SSO 集成
- 不做模型用量计费或 token 消耗追踪
- 不做 Google Gemini 协议适配（暂只支持 OpenAI/Anthropic/Ollama 三种协议格式，覆盖 99% 的 models.dev provider）
- 不支持用户自定义添加全新的协议格式 provider（只支持已有的三种格式）
- 不做多用户/多租户（当前单用户模式不变）

## Decisions

### D1: 配置存储 — 统一到 SQLite KV 表

**选择**：使用 SQLite 键值表 `app_config` + `provider_keys` 表存储所有配置

**替代方案**：
- (a) 继续用 JSON 文件 — 不支持并发安全、无法和 session 数据原子操作
- (b) 环境变量 — 无法 per-provider 管理多 key

**理由**：SQLite 已是系统的核心存储，配置和业务数据在同一事务中可保证一致性。KV 表足够灵活，不需要复杂的 schema。

### D2: models.dev 数据缓存 — 拆表存储

**选择**：拆分为 `provider_info_cache`（provider 元数据）和 `provider_models_cache`（model 元数据）两张表

**替代方案**：
- (a) 存一个大 JSON 文件 — 每次都要反序列化 2.4MB，前端 provider 联动 model 时性能差
- (b) 只存前端需要的子集 — 无法按需查询，丧失灵活性

**理由**：前端 provider 下拉联动 model 下拉时，只需加载当前 provider 的 models。拆表后 `WHERE provider_id = ?` 精准查询，响应在毫秒级。

### D3: 内置快照 — Go embed 精简 JSON

**选择**：Go embed 一个精简的 JSON 文件，只包含 ~20 个常用 provider 的核心字段

**理由**：models.dev 完整数据 2.4MB，embed 进二进制太大。精简到常用 provider（openai/anthropic/ollama/groq/deepseek/mistral/openrouter/together/google 等）约 100KB，启动秒加载。同步完成后自动替换为完整数据。

### D4: Session LLM Client 创建 — 每次请求新建

**选择**：每次 `streamSessionReply` 调用时根据 session 的 provider/model + provider_keys 表的 API Key 新建 `llm.Client`

**替代方案**：
- (a) Client pool/缓存 — http.Client 本身是轻量 wrapper，池化收益小，增加复杂度
- (b) 全局单例 + 动态切换 — 并发不安全

**理由**：`llm.Client` 本质是一个 `http.Client` wrapper，创建成本极低。每次新建避免并发问题和状态管理复杂度。

### D5: 协议格式映射 — provider_id → api_format

**选择**：在 `provider_info_cache` 表中增加 `api_format` 字段（`openai` | `anthropic` | `ollama`），映射 provider 到其底层协议格式

**理由**：models.dev 中 90% 以上的 provider 兼容 OpenAI 格式。DeepSeek 的 provider_id 是 `deepseek`，但协议格式是 `openai`。这个映射关系需要在缓存时确定。具体映射规则：
- `anthropic` → `anthropic`
- `ollama` → `ollama`
- 其余所有 → `openai`（包括 openai 自身、groq、deepseek、mistral、together 等）

### D6: "最近使用"更新时机 — session 切换 provider/model 时

**选择**：当用户通过 `PATCH /sessions/{id}` 更新 session 的 provider 或 model 时，同时更新 `app_config` 的 `last_provider` 和 `last_model`

**理由**：用户在对话中切换模型是最自然的"最近使用"信号。在 Settings 页改则不更新（那是改默认值，不是"最近使用"）。

### D7: 前端多 session 管理 — Context 重构

**选择**：`AppContext` 从单 session 扩展为多 session 管理，增加 `sessions` 列表、`activeSessionId`、`switchSession`、`createSession` 方法

**理由**：当前 `AppContext` 只维护一个 `sessionId`。多 session 需要列表、切换、创建三个核心操作。侧边栏组件 `ChatSidebar` 消费这些数据。

### D8: 输入框守卫逻辑

**选择**：三个条件全部满足才 enable 输入框：(1) session 有 provider、(2) session 有 model、(3) 该 provider 在 `provider_keys` 表中有 API Key

**理由**：任何一个缺失都会导致 LLM 调用失败，提前在 UI 层拦截比发请求后报错体验好得多。

## Risks / Trade-offs

- **[models.dev 不可用]** → 内置快照兜底，系统始终可用。同步 goroutine 失败不阻塞任何请求
- **[API Key 明文存储在 SQLite]** → 与当前 `.llmwiki/config.json` 明文存储安全级别一致，未降低安全性。未来如需加密可透明替换存储层
- **[迁移：.llmwiki/config.json → SQLite]** → 需要一次性迁移脚本。如果用户有现有配置，启动时检测到 JSON 文件存在且 SQLite 中无配置则自动迁移
- **[models.dev 数据量大]** → 拆表查询 + 只加载当前 provider 的 models，前端不会一次性加载 4000+ models
- **[内置快照过期]** → 定时同步（每小时）会自动更新。离线运行时使用缓存数据，不会出错
- **[前端多 session 状态管理复杂度]** → 当前 `AppContext` 已经是重度状态管理，多 session 会增加复杂度。但模式清晰（列表 + 当前 + 切换），可控
