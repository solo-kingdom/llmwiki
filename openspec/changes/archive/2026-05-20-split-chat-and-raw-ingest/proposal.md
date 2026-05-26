## Why

当前默认入口是聊天归档（探索后归档），适合需要和模型反复澄清的场景；但在很多场景里，用户已经有成型原始材料，只希望快速上传/粘贴后直接归档，不需要先进行多轮对话。现有入口命名和信息架构将这两种模式混在一起，导致用户心智不清晰。

## What Changes

- 将当前导航中的 `Ingest` 聊天入口重命名为 `Chat`，明确其定位是“对话探索后归档”
- 新增独立 `Ingest` 页面，定位为“Raw 直投归档”
- 新 `Ingest` 页支持两类输入：
  - 上传多个文件（复用现有上传 ingest 能力）
  - 粘贴多个文本块（支持新增/删除文本块）
- 新 `Ingest` 页提供统一主操作 `直接归档`：一次提交当前批次内容到 ingest pipeline，并给出任务反馈
- 保持 `Jobs` 页作为统一任务观测入口，提交后可跳转或联动到 `Jobs`

## Capabilities

### New Capabilities

- `ingest-raw-ui`: 原始数据直投摄入页面，支持多文本块与多文件混合提交，并一键归档

### Modified Capabilities

- `web-ui`: 顶部导航与路由信息架构从“默认 Ingest=Chat”调整为“Chat + Ingest 并列”
- `ingest-chat-ui`: 聊天页保持能力不变，但入口文案、路由语义调整为 Chat

## Impact

- **前端路由与导航**：`WorkbenchView`、导航文案、默认路由映射需要调整
- **前端组件**：新增 Raw Ingest 页面组件；复用并整合现有文本与上传能力
- **AppContext/API 复用**：优先复用 `createTextIngestJob`、`uploadIngestJobs`、`refreshIngestJobs`，减少后端改动
- **测试更新**：导航、路由恢复、Ingest Chat 页面文案与新 Ingest 页面交互测试需同步更新
- **后端影响**：首版可零后端改动；如后续需要事务化“批次提交”可再补统一 batch API
