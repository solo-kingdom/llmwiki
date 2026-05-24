## 1. 格式化工具

- [x] 1.1 新增 `web/src/lib/format-session-messages.ts`，实现 `formatSessionMessagesForCopy(messages, labels)`，按 design 规则拼接纯文本
- [x] 1.2 新增 `web/src/lib/format-session-messages.test.ts`，覆盖：多轮对话、跳过 system、wiki_refs 附加、附件摘要、失败/空 content 用 error_message、streaming partial content

## 2. i18n

- [x] 2.1 在 `web/src/i18n/messages/zh.ts` 与 `en.ts` 添加 `chat.copy_all`、`chat.copy_role_user`、`chat.copy_role_assistant`、`chat.copy_attachment_label` 键

## 3. UI 集成

- [x] 3.1 在 `IngestChat.tsx` 的 `ingest-message-panel` 内、`ScrollArea` 上方添加顶栏与 copy-all 按钮（右对齐）
- [x] 3.2 实现 copy-all 点击处理：调用格式化函数 + `copyTextToClipboard`，copied 状态 2 秒反馈
- [x] 3.3 无 copyable 消息时隐藏按钮；流式输出中仍可用

## 4. 测试

- [x] 4.1 在 `web/src/ingest-chat.test.tsx` 添加集成测试：有多条消息时点击 copy-all，验证 clipboard 收到格式化全文
- [x] 4.2 验证空会话不渲染 copy-all 按钮
