## Why

Chat 页面存在三个独立的交互体验缺陷：

1. **无法打断模型回复**：用户发送消息后，必须等待 LLM 完整回复结束（tool loop 最长 4 轮 × 4 次调用），无法中途中断。如果模型回复方向错误或过于冗长，用户只能干等。
2. **消息操作不直观**：复制按钮藏在气泡右上角，hover 才显示；缺少"排除归档"能力——用户无法在归档前标记某些无关或错误的消息使其不参与 LLM 归档分析。
3. **Wiki 页面引用体验割裂**：`WikiMentionPicker` 是一个独立的搜索输入框，与主 textarea 分离，用户需要先在上面搜索、选择，再切到 textarea 写消息。期望的体验是在 textarea 中输入 `@` 即触发 fzf 风格的模糊搜索弹出面板。

## What Changes

三个独立功能，互不依赖：

### 功能 1：Stop 按钮（打断模型回复）

- 流式回复期间，发送按钮变为 **Stop 按钮**（ChatGPT 风格）
- 用户点击 Stop → 前端通过 `AbortController.abort()` 断开 SSE 连接
- 后端已有 `ctx.Err()` 检查机制，会将消息标记为 `incomplete` 并保存已收到的部分内容
- 前端显示已收到的部分内容 + Retry 按钮（现有逻辑已覆盖 `incomplete` 状态）

### 功能 2：消息图标栏

- 每条消息气泡**外下方**添加一行操作图标，hover 时显示
- 图标包含：**复制**（从右上角移下来）、**不归档**（toggle，勾选后该消息不参与归档）
- 后端 `IngestSessionMessage` 新增 `exclude_from_archive` 布尔字段
- 新增 `PATCH /api/v1/ingest/sessions/{id}/messages/{messageId}` 端点更新该字段
- 归档逻辑 (`ArchiveIngestSession`) 过滤掉被标记的消息

### 功能 3：@ 触发 fzf 风格 Wiki 搜索

- 移除独立的 `WikiMentionPicker` 搜索输入框
- 用户在 textarea 中输入 `@` 时，检测光标位置，弹出搜索面板
- 面板显示 wiki 页面列表（来自已有 `documents` state），随用户输入做 fzf 模糊匹配筛选
- 选择文件后：清除 `@query` 文本，将引用添加到 `wikiRefs`，在 textarea 上方显示 tag

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ingest-session-api`：新增 PATCH message 端点；归档逻辑增加 exclude 过滤
- `ingest-chat-ui`：Stop 按钮、消息图标栏、@ 触发 fzf 搜索面板
- `wiki-mention`：触发方式从独立搜索框改为 textarea 内 `@` 触发

## Impact

- **Backend**：`IngestSessionMessage` 结构加字段；新增 PATCH handler；`ArchiveIngestSession` 加过滤；SQLite migration
- **Frontend**：`AppContext` 加 `cancelStream` / `toggleExcludeArchive`；`MessageBubble` 重构图标位置；`WikiMentionPicker` 重写触发逻辑；新增 fzf 模糊匹配函数
- **i18n**：`chat.stop`、`chat.exclude_from_archive` 等翻译键
- **Dependencies**：前端新增 fzf 模糊匹配库（如 `fzf.js` 或 `fuse.js`）

## Non-Goals

- 不做 inline chip（在 textarea 内显示样式化引用标签）—— textarea 不支持富文本
- 不做键盘导航选择搜索结果（首版仅鼠标点击）
- 不改变归档的整体流程或 Review 机制
- 三个功能之间不产生联动
