## Context

`IngestChat.tsx` 是 Chat 页主组件，消息列表在 `ingest-message-panel` 内的 `ScrollArea` 中渲染。单条消息已通过 `MessageBubble` hover 操作栏提供复制能力，使用 `@/lib/clipboard` 的 `copyTextToClipboard`。会话消息来自 `AppContext.sessionMessages`（`IngestSessionMessage[]`），无后端 API 变更需求。

Explore 阶段已确认：按钮放在消息面板顶栏右侧，复制格式为角色标签 + 纯文本。

## Goals / Non-Goals

**Goals:**

- 一键复制当前会话全部可见对话内容为纯文本
- 按钮位置直观、不干扰现有 composer 工具栏
- 复用现有 clipboard 工具与 copied 反馈模式
- 覆盖中英文 i18n

**Non-Goals:**

- 导出为文件（Markdown / JSON）
- 复制 system 消息、tool_status、tool_reads 等调试信息
- 后端新 API 或持久化
- 自定义复制格式选项（如 Markdown / 带时间戳）

## Decisions

### 1. 按钮位置：消息面板顶栏

在 `data-testid="ingest-message-panel"` 容器内、`ScrollArea` 上方增加薄顶栏，右对齐复制按钮。

**理由**：操作对象是对话历史，与单条复制同属消息区；底部 composer 已较拥挤。

**备选**：底部工具栏（归档旁）— 语义弱、占空间，已否决。

### 2. 格式化逻辑：独立纯函数

新增 `formatSessionMessagesForCopy(messages, labels)`，放在 `web/src/lib/format-session-messages.ts`（或同目录 test 文件）。

**理由**：逻辑可单测，与 React 组件解耦；格式化规则稳定、易扩展。

**备选**：内联在 `IngestChat` — 可行但不利测试，已否决。

### 3. 复制内容与格式

按 `sessionMessages` 顺序遍历，规则如下：

| 消息类型 | 处理 |
|---------|------|
| `role: user` | 包含，`{UserLabel}: {content}` |
| `role: assistant` + `message_type: text` | 包含，`{AssistantLabel}: {content}` |
| `role: assistant` + `message_type: attachment_summary` | 包含，前缀 `[Attachment]`（i18n） |
| `role: system` | 跳过 |
| 空 content（且无 error） | 跳过该条 |
| streaming / incomplete / failed | 使用当前 `content`；若 content 为空则用 `error_message` |
| `wiki_refs` | 附在用户消息 content 后，每行 `- {title or path}` |
| `exclude_from_archive` | 仍复制（完整 transcript） |
| `tool_status` / `tool_reads` | 不包含 |

块之间用 `\n\n` 分隔。

**理由**：与单条复制一致（纯 content）；适合粘贴到笔记或其他 LLM。

### 4. UI 交互

- 图标：`Copy`（lucide-react），与单条复制一致
- 可见性：`sessionMessages` 中至少有一条可复制内容时显示
- 点击后：`copyTextToClipboard` → 成功则 2 秒内显示 copied 状态（aria-label / title 切换）
- 流式输出中：允许复制（当前已输出部分）

### 5. i18n 键

- `chat.copy_all`：「复制全部」/ "Copy all"
- `chat.copy_all_copied`：「已全部复制」/ "All copied"（或复用 `chat.copied`）
- `chat.copy_role_user` / `chat.copy_role_assistant`：角色标签（若与 UI 其他文案分离）
- `chat.copy_attachment_label`：附件摘要前缀

## Risks / Trade-offs

- **[Risk] Assistant markdown 原样复制** → 用户粘贴到其他编辑器会看到 markdown 语法；与单条复制行为一致，可接受
- **[Risk] 长会话剪贴板体积** → 无分页；MVP 不限制长度，后续可加 toast 提示
- **[Risk] 流式中途复制内容不完整** → 预期行为；用户可在完成后再次复制
