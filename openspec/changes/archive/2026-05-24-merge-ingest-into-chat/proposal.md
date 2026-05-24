## Why

当前 Workbench 将「对话式摄入」（Chat）与「原始材料直投」（Ingest `/ingest`）拆成两个独立导航入口，用户需在页面间跳转才能完成「多轮探索归档」与「成品材料直接提交」两类工作流。继 Review 页面内嵌到 Chat 之后，应继续收敛 Workbench 导航，在 Chat 内提供直投能力，形成单一摄入入口。

## What Changes

- 在 Ingest Chat 内嵌 **直接归档面板（DirectIngestPanel）**：复用现有 `IngestRaw` 的文件上传、多文本块与批次提交能力，以 Sheet/Dialog 形式从 composer 区打开
- 空会话状态增加 **双 CTA**：「开始对话」与「直接归档材料」，引导两类工作流
- **移除 Ingest 独立页面** 及 Workbench `ingest` 导航入口（**BREAKING**）
- `/ingest` 路径与 legacy `#ingest` hash **重定向** 到 Chat 并自动打开直接归档面板
- **删除遗留 `IngestHub` 组件**及其测试（已不在主路径）
- 导航文案统一：Chat 作为唯一摄入入口，移除独立的「摄入」Tab
- 后端 API **不变**（仍使用 `submitText` / `submitUpload`）；提交成功后提供 toast 与可选跳转 Jobs

## Capabilities

### New Capabilities

（无新增 capability——直投 UI 作为 Chat 内嵌子流程，归入现有 ingest-chat-ui 与 web-ui 需求变更。）

### Modified Capabilities

- `ingest-chat-ui`：新增直接归档面板入口、空状态双 CTA、提交反馈与 Jobs 跳转；composer 工具栏增加「直接归档」按钮
- `web-ui`：移除 Ingest 独立导航项与 `/ingest` 视图；更新默认 landing 与路由重定向规则

## Impact

- **前端**: 新增 `DirectIngestPanel`（自 `IngestRaw` 提取）；改造 `IngestChat.tsx`、`WorkbenchLayout.tsx`、`wiki-routes.ts`；删除 `IngestRaw.tsx`（或降级为 panel 子组件）、`IngestHub.tsx`；更新 i18n（zh/en）
- **测试**: 迁移 `ingest-raw.test.tsx` 至 Chat 集成测试；更新 `app-nav.test.tsx`、`wiki-routes.test.ts`；删除 `ingest.test.tsx` 中 IngestHub 相关用例
- **Breaking**: 移除 `/ingest` Workbench 视图与 Ingest 导航 Tab
