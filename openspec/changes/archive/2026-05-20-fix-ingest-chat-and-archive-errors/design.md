## Context

前端当前已经将 Wiki reader 从工作台 tab 中分离出来：`App.tsx` 根据 `window.location.pathname` 在 `WikiReaderLayout` 与 `WorkbenchLayout` 之间切换，工作台内只保留 `Ingest`、`Jobs`、`Timeline`、`Settings`。Ingest Chat 则集中在 `IngestChat.tsx`，通过 `AppContext` 管理 session、messages、provider instances、models、stream send、attachments 与 archive。

后端会话聊天使用 `/api/v1/ingest/sessions/{id}/messages?stream=1` 返回 SSE。当前前端可以处理 `user_message`、`token`、`done`、`error` 事件，但 `error` 事件中的具体 message 没有进入 UI 状态；后端也没有为 stream error 统一写日志。服务器层全局使用 `chimw.Timeout(60s)`，`http.Server` 也设置了 `WriteTimeout: 30s`，这与长时间 LLM streaming 存在天然冲突。

`session_archive` 失败里的 `unsupported protocol scheme ""` 表示 LLM request URL 变成了 `"/chat/completions"`。目前 `llm.Client.buildURL()` 对空 base URL 没有提前校验，因此错误发生在 HTTP client 发送请求时，离真正配置原因已经很远。归档分析链路还把底层错误包装成泛化 pipeline 失败，用户只能去翻日志。

## Goals / Non-Goals

**Goals:**

- 稳定 Wiki reader 入口：点击 Wiki 后不应被工作台 view 状态抢回 Ingest。
- 让 Ingest Chat 的输入区成为完整操作中心：会话、模型、归档、附件、发送全部在输入框下方组织。
- 保持 token streaming 实时回显；失败时展示明确错误原因，并允许用户一键重发。
- 为消息提供复制能力，覆盖用户消息、助手回复和附件摘要。
- 避免正常长回复被 HTTP timeout/write timeout 中断。
- 在创建 LLM client 或发送请求前校验 provider instance、model、base URL、API key 等必要配置，让 `session_archive` 失败变成可操作错误。

**Non-Goals:**

- 不重写完整路由系统或引入 React Router。
- 不重新设计 provider/model 管理页面。
- 不新增多用户权限、文档级 ACL 或新的公开 Wiki 配置模型。
- 不改变归档产物格式或 ingest pipeline 的核心语义。

## Decisions

### D1: Wiki 入口修复以轻量 path store 为边界

**决策**: 保持当前 `useSyncExternalStore` + pathname 判断的轻量路由方式，但明确所有工作台到 Wiki 的入口使用真实 `href="/wiki"` 或受控导航 helper；测试覆盖从 `/` 渲染工作台后点击 Wiki 能进入 reader shell。

**理由**:

- 当前架构已经选择轻量路径识别，问题更像回归修复而不是路由系统缺失。
- 不引入路由库可以降低改动面，避免影响 `separate-public-wiki-reader` 已完成的 reader layout。

**实现注意**:

- 如果需要使用 `history.pushState`，必须同步触发 path store 订阅事件；否则 `useSyncExternalStore` 只监听 `popstate` 会漏掉程序化导航。
- Wiki reader 在 public wiki disabled 且私有 API 请求失败时，应展示明确错误，不应隐式跳回工作台。

### D2: Ingest 输入区采用两端 action bar

**决策**: 将 `SessionControls` 从聊天顶部移到输入框下方 action bar 左侧；同一行左侧依次放置 `切换`、`新建`、`模型`、`归档`，右侧放置 `附件`、`发送`。

**理由**:

- 用户发送前最常使用的是会话、模型、附件和发送，这些操作属于同一个输入工作流。
- `归档` 依赖当前会话内容，也更适合靠近输入区和发送路径，而不是与附件/发送混杂。

**实现注意**:

- `SessionControls` 应支持作为 inline action group 渲染，避免保留顶部边框条。
- `归档` 仍需在没有用户消息、没有 session 或 busy 时禁用。
- Ingest 根容器宽度应与 `PageContainer` 的 `max-w-5xl` 对齐，聊天消息可以在内部控制气泡最大宽度。

### D3: 消息操作是气泡级能力

**决策**: `MessageBubble` 增加轻量操作区：复制按钮始终可用；当助手消息 `stream_status === "failed"` 时显示失败原因和重发按钮。

**理由**:

- 复制和重发都与单条消息上下文绑定，放在气泡内部可减少全局状态复杂度。
- 重发需要定位失败助手消息前最近一条用户消息，保持用户原始输入不丢失。

**实现注意**:

- 类型层可为 `IngestSessionMessage` 增加可选 `error_message` 或前端本地扩展字段，用于承载 SSE error message。
- 若失败发生在用户消息已写入数据库但助手失败的场景，重发会创建新的用户消息；本次接受这种显式重试轨迹，不做消息覆盖。
- 剪贴板 API 失败时应有降级提示或至少不破坏 UI。

### D4: SSE 错误必须保留原始原因并写日志

**决策**: 后端 `streamSessionReply` 对 `client.StreamChat` 初始化失败、流内 error、空回复/incomplete 等关键失败路径统一写日志，并在 SSE `error` 事件中发送 `{ message }`。前端收到 error 后展示该 message，不再只写死“回复失败”。

**理由**:

- 当前用户只能看到 `Error in input stream` 或“回复失败”，无法区分配置错误、鉴权错误、超时、额度限制、上下文长度等问题。
- 服务端日志需要保留 session id / provider instance / model 等排查上下文，但不能泄露 API key。

**实现注意**:

- stream HTTP 响应已经开始后不能再返回 JSON status，因此 SSE error 是唯一用户可见错误通道。
- 前端 `streamIngestSessionMessage` 需要处理流读取异常：如果 fetch/reader 抛错，要把错误写入临时助手消息并保留已收到 token。
- 长回复中断时不要清空已经回显的内容，应将状态标记为 failed 或 incomplete 并显示原因。

### D5: LLM client 在请求前校验 base URL

**决策**: `llm.Client.StreamChat` 在构造请求前校验 provider、base URL、model、API key 等必要字段。base URL 为空或非法时返回明确错误，例如“Provider base URL is not configured for instance X”。

**理由**:

- `unsupported protocol scheme ""` 是底层 HTTP 错误，对用户没有修复指向。
- 同一 LLM client 同时服务 chat、附件摘要、归档分析等链路，集中校验可以一次修复多处。

**实现注意**:

- provider catalog 默认 base URL 与 instance override 的优先级保持现状：instance `base_url` 优先，否则使用 catalog `api_base`。
- 若 catalog 也没有 base URL，应在创建 client 前失败；错误消息应指向 Settings 的 provider instance/base URL 配置。
- `session_archive` pipeline 捕获该错误时，应将 job 的 `error_message` / `remediation` 写成可操作提示，而不是泛化成“check logs”。

### D6: Stream 超时需要避开短 HTTP 中间件

**决策**: 调整 HTTP server/middleware 对 SSE route 的超时策略：stream route 不应被 60s chi timeout 或 30s write timeout 提前终止。

**理由**:

- LLM 回复天然可能超过 60 秒，尤其在归档分析、长上下文、多轮总结时。
- 业务层已有 LLM client timeout 与 idle timeout，更适合控制 stream 生命周期。

**实现注意**:

- 可以将全局 `chimw.Timeout` 改为只包普通 API，或对 stream route 使用独立子路由/handler 绕开。
- `http.Server.WriteTimeout` 对 streaming 响应不友好，需移除或放宽到大于 LLM 最大超时。
- 保留 request context 取消能力，浏览器断开时后端应停止读取 LLM stream。

## Risks / Trade-offs

- **[重发重复消息]** 重发失败会产生新的用户消息，历史中可能出现重复提问。相比隐式覆盖，显式轨迹更容易审计，后续可再做“从此处重试”。
- **[错误信息泄露]** 后端错误可能包含供应商响应正文。需要截断并避免输出 API key、Authorization header 或完整请求体。
- **[超时放宽导致资源占用]** 放宽 HTTP timeout 后，卡死 stream 可能占用连接。通过 LLM client idle timeout、request context 和日志监控缓解。
- **[Wiki 回归来源不确定]** 若真实问题来自部署层 fallback 或 token auth，而非前端 path store，修复可能需要同时调整 server SPA fallback/auth 测试。
