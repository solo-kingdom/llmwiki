## Context

Workbench 当前有两个摄入相关入口：

- **Chat** (`/`): `IngestChat` — 多轮 LLM 会话、附件理解、归档审阅闭环
- **Ingest** (`/ingest`): `IngestRaw` — 批量文件与多文本块直投，调用 `submitText` / `submitUpload` 直接进入 Jobs 管线

另有已废弃的 `IngestHub`（一次性 `submitConversation`），不在导航中。

刚完成的 `chat-closed-loop-archive` 已将 Review 内嵌到 Chat；本变更以相同模式将 Raw Ingest 内嵌到 Chat，进一步收敛 Workbench 导航。

SessionControls 已有 `ingest / qa / organize` 三种 **LLM 行为模式**，与 Raw Ingest 的「绕过 session 直投」是不同概念，不应混为第四种 session mode。

## Goals / Non-Goals

**Goals:**

- 单一摄入入口：用户在 Chat 内完成对话归档与成品材料直投
- 复用 `IngestRaw` 现有逻辑与 API，最小化后端改动
- `/ingest` 与 legacy hash 平滑重定向
- 删除 `IngestHub` 遗留代码

**Non-Goals:**

- 不改变 `submitText` / `submitUpload` / session archive API 语义
- 不合并「会话附件上传」与「直投文件上传」为同一控件（避免 UX 混淆）
- 不改造 Jobs 页面本身
- 不新增 session mode

## Decisions

### 1. UI 容器：Sheet Dialog（非 inline 折叠）

**选择**: 使用 `@base-ui/react/dialog` 实现全屏或宽 Sheet，从 composer 工具栏打开。

**理由**: composer 区已有会话切换、模式切换、模型、归档、附件、发送等控件，inline 折叠会进一步拥挤。Sheet 与 `ArchiveReviewCard`（inline 卡片）互补：审阅是 session 上下文内的持续状态，直投是独立的一次性操作。

**备选**: inline 折叠面板 — 拒绝，占用消息区垂直空间且与 ArchiveReviewCard 堆叠混乱。

### 2. 组件结构：提取 `DirectIngestPanel`

**选择**: 从 `IngestRaw.tsx` 提取核心表单与提交逻辑为 `DirectIngestPanel.tsx`，接受 `open` / `onOpenChange` props；删除独立 `IngestRaw` 页面组件。

**理由**: 保留现有 `composeTextBlocksToMarkdown`、文件列表、批次信息、提交摘要等逻辑，降低回归风险。

### 3. 入口设计：composer 按钮 + 空状态 CTA

**选择**:

- composer 工具栏新增「直接归档」按钮（`Upload` 或 `FileInput` 图标），始终可见
- 空会话时在消息区展示双 CTA：主提示保留对话引导，次要按钮「直接归档材料」打开 Sheet

**理由**: 空状态解决首次访问发现性；composer 按钮解决已有会话时的直投需求。

### 4. 路由与导航

**选择**:

- 从 `WorkbenchView` 移除 `ingest`；删除 `/ingest` 路由渲染
- `/ingest` 访问时 `navigateTo("/")` 并设置 query `?directIngest=1` 或等效 state 以自动打开 Sheet
- legacy `#ingest` hash 重定向到 `/` 并打开 Sheet（延续现有 `#ingest` → chat 的处理模式）
- 导航保留 `Chat` 条目（label 按 `ingest-chat-ui` spec 显示为 **Ingest**），移除独立 Ingest Tab

**理由**: breaking change 可控，deep link 可迁移。

### 5. 提交后反馈

**选择**: 提交成功后 Sheet 内显示摘要（复用现有 success/fail 区块），提供「查看 Jobs」按钮；可选在成功后自动关闭 Sheet（保留摘要 toast）。

**理由**: 与现有 `IngestRaw` 行为一致，用户可立即确认 job 创建结果。

## Risks / Trade-offs

- **[Risk] 直投功能 discoverability 下降** → 空状态双 CTA + composer 常驻按钮；i18n 文案明确区分「对话归档」与「直接归档」
- **[Risk] composer 控件过多** → Sheet 而非 inline；不在 composer 展开表单字段
- **[Risk] `/ingest` bookmark 失效** → query 参数重定向自动打开 Sheet
- **[Risk] 测试覆盖迁移遗漏** → 将 `ingest-raw.test.tsx` 迁为 `DirectIngestPanel` 单元测试 + Chat 集成测试

## Migration Plan

1. 实现 `DirectIngestPanel` 并嵌入 `IngestChat`
2. 添加路由重定向与 query 触发逻辑
3. 移除 `ingest` nav/view、`IngestRaw` 页面、`IngestHub` 遗留
4. 更新 i18n、测试
5. 无后端迁移；无数据库变更

**Rollback**: 恢复 `IngestRaw` 页面与 `/ingest` 路由即可，API 未变。

## Open Questions

- Chat 导航 label 统一为「Ingest」还是保留「对话」？→ 建议遵循现有 `ingest-chat-ui` spec 使用 **Ingest**，直投按钮用「直接归档」区分
- Sheet 提交成功后是否自动关闭？→ 建议默认保持打开显示摘要，用户手动关闭或点「查看 Jobs」
