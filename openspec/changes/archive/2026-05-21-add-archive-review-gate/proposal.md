## Why

当前 `chat/ingest` 触发的会话归档流程是“归档后立即入队执行，两阶段 LLM 直接落盘 wiki 文件”。这在效率上可行，但缺少关键的人审闸门：

1. 用户无法在改动文件前审核“将要改什么、为什么改”
2. 用户无法通过对话反复修正计划后再执行
3. 归档失败后缺少以“重新规划”为中心的恢复路径

归档是 llm wiki 服务里高风险且高价值的入口，必须从“直接执行”升级为“先计划、可审核、再执行”的流程。

## What Changes

- 新增“归档审阅（Review）”阶段：归档后不再直接写文件，而是先生成可审阅的修改计划
- 新增独立 Review 页面：用于查看计划、自然语言反馈、重新规划、审核通过
- 明确执行闸门：只有审核通过后，才进入最终写文件流程
- 审核通过后的执行策略改为：基于最终计划重新生成 FILE blocks，再执行落盘
- 失败恢复入口放在 Review 页面：审核失败时可直接“重新规划”并继续审核，不依赖 Jobs 页面
- 归档后的默认交互改为停留在 Chat，并提示“去审核”

## Capabilities

### New Capabilities

- `archive-review-workflow`: 面向 session archive 的“规划-审核-批准-执行”闭环
- `archive-review-ui`: 独立 Review 页面，支持计划版本查看与自然语言反馈重规划

### Modified Capabilities

- `ingest-session-api`: 归档 API 从“直接排队执行”调整为“创建 review 并生成计划”
- `ingest-pipeline`: 增加“计划阶段禁止写文件”的约束与“批准后重生成 FILE blocks”的执行语义
- `web-ui`: Chat 归档后停留当前页并引导审核；新增 Review 页面与状态联动

## Impact

- **后端 API 与状态机**: `internal/api/ingest_session.go`, `internal/api/ingest.go`, `internal/server/server.go`
- **摄取执行链路**: `internal/ingest/processor.go`, `internal/ingest/pipeline.go`, 相关 job/review 记录逻辑
- **数据层**: `internal/store/sqlite/` 下新增 review 相关 schema 与读写接口
- **前端**: `web/src/components/`、`web/src/context/AppContext.tsx`、`web/src/lib/api.ts`、路由与导航
- **测试**: 覆盖计划生成、审核反馈、重新规划、审核通过后执行、失败重规划与 job 级回滚路径
