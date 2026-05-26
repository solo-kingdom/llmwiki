## Why

Chat 页面已支持单条消息复制，但用户在与助手多轮对话后，常需要将整段会话导出到笔记、其他 LLM 或外部文档。逐条 hover 复制效率低，缺少一键复制全部消息的入口。

## What Changes

- 在消息面板顶栏新增「复制全部」按钮，仅在有消息时显示
- 点击后将当前会话全部可见消息格式化为纯文本并写入剪贴板
- 复制格式为「角色标签 + 内容」，用户与助手消息之间以空行分隔
- 复用现有 `copyTextToClipboard` 与 copied 反馈交互（2 秒状态切换）
- 新增 i18n 文案（中英文）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ingest-chat-ui`：新增「复制全部消息」需求，定义按钮位置、可见性、复制内容与格式规则

## Impact

- **前端**：`web/src/components/IngestChat.tsx`（顶栏 UI、格式化逻辑）
- **i18n**：`web/src/i18n/messages/zh.ts`、`en.ts`
- **测试**：`web/src/ingest-chat.test.tsx`
- **后端 / API**：无变更
