## 1. Wiki reader 入口回归

- [x] 1.1 补充前端测试：从工作台默认 Ingest 点击 Wiki 入口后应渲染 `WikiReaderLayout`，且不再显示 Ingest 页面内容
- [x] 1.2 检查 `App.tsx` path store 与 `wikiReaderHref()` 使用方式，修复 push/replace/popstate 不同步或链接行为导致的回退
- [x] 1.3 检查 public wiki disabled、token auth、私有 API 失败时的 reader 错误状态，确保不会隐式跳回 Ingest
- [x] 1.4 手动验证 `/wiki`、`/wiki?doc=<id>`、从工作台点击 Wiki、从 reader 点击管理工作台四条路径

## 2. Ingest Chat 输入区布局与宽度

- [x] 2.1 调整 `IngestChat` 外层宽度，与 `PageContainer` 的管理页面宽度策略保持一致
- [x] 2.2 移除输入框上方独立 `SessionControls` bar，将会话切换/新建移入输入框下方 action bar
- [x] 2.3 重排 action bar：左侧为 `切换`、`新建`、`模型`、`归档`，右侧为 `附件`、`发送`
- [x] 2.4 保留当前 provider/model 状态展示，并确认无 provider/model 时的禁用与引导文案仍然清晰
- [x] 2.5 更新前端测试覆盖按钮位置、按钮可见性、归档禁用状态和页面宽度类名/容器行为

## 3. 消息复制与失败重发

- [x] 3.1 为 `MessageBubble` 添加复制按钮，覆盖用户消息、助手消息和附件摘要
- [x] 3.2 为失败助手消息展示具体错误原因，而不是只显示“回复失败”
- [x] 3.3 为失败助手消息添加“重新发送”按钮，重发最近一条相关用户消息
- [x] 3.4 在重发时保留原失败消息，追加新的用户消息与助手 stream，避免静默覆盖历史
- [x] 3.5 增加前端测试：复制按钮调用 clipboard、失败原因展示、重发调用 `sendSessionMessage`

## 4. 前端 stream 解析与错误状态

- [x] 4.1 扩展 `IngestSessionMessage` 或前端本地 message 类型，支持可选错误原因字段
- [x] 4.2 更新 `streamIngestSessionMessage` 读取逻辑，确保 reader/fetch 抛错时把错误传回调用方
- [x] 4.3 更新 `AppContext.sendSessionMessage`：SSE `error` 事件应把 `message` 写入临时助手消息并标记 failed
- [x] 4.4 当 stream 已产生部分 token 后失败，应保留已回显内容并显示失败原因
- [x] 4.5 确认 `done` 事件的 final assistant message 不会错误覆盖前端已收到的 token 或错误状态

## 5. 后端 stream 日志与超时

- [x] 5.1 在 `streamSessionReply` 中为 LLM client 创建失败、`StreamChat` 初始化失败、流内 error、空回复/incomplete 写入安全日志
- [x] 5.2 SSE error 事件统一发送 `{ "message": "<reason>" }`，并避免泄露 API key 或 Authorization 信息
- [x] 5.3 调整 `server.go` 中 stream route 的 timeout/write timeout 策略，避免正常 LLM streaming 被 60s/30s 截断
- [x] 5.4 补充后端测试或 handler 级测试，覆盖 stream error 事件包含 message 且不会返回泛化空错误

## 6. LLM 配置校验与 session_archive 错误提示

- [x] 6.1 在 `llm.Client.StreamChat` 或 client 构造路径中校验 `base_url` 不能为空且必须是合法 URL
- [x] 6.2 检查 provider instance + catalog fallback：instance `base_url` 为空时应正确使用 catalog `api_base`
- [x] 6.3 当 catalog/instance 都缺少 base URL 时，返回可操作错误，提示用户到 Settings 配置 Provider base URL
- [x] 6.4 修复 `session_archive` / 归档分析链路的错误包装，让 job `error_message` 与 `remediation` 体现 provider/base URL 配置原因
- [x] 6.5 补充 LLM client 配置测试：空 base URL 不应发起 `Post "/chat/completions"`，而应提前返回配置错误

## 7. 验证

- [x] 7.1 运行前端测试：`npm test -- --runInBand` 或项目既有 Vitest 命令
- [x] 7.2 运行前端构建/类型检查：`npm run build`
- [x] 7.3 运行 Go 测试，至少覆盖 `internal/llm`、`internal/api`、`internal/server`、`internal/ingest`
- [x] 7.4 手动验证：Wiki 入口、Ingest action bar、复制、失败重发、stream 实时回显、长回复不中断、session_archive 配置错误提示
