## 1. Context append API 接入

- [x] 1.1 在 `AppContext.tsx` 新增 `appendContextMessage(content)`，调用 `api.appendIngestSessionMessage`，乐观追加 user bubble，不设置 `sessionBusy`
- [x] 1.2 导出 `appendContextMessage` 到 context value，供 Chat 组件使用

## 2. ContextInputDialog 组件

- [x] 2.1 新建 `ContextInputDialog.tsx`：多文本块 UI（复用 `composeTextBlocksToMarkdown`），提交调用 `appendContextMessage`
- [x] 2.2 Dialog 提交成功后清空表单并关闭；失败时展示错误
- [x] 2.3 新增 `context-input-dialog.test.tsx` 覆盖打开、多块输入、提交 API 调用

## 3. IngestChat 改造

- [x] 3.1 composer 移除「直接归档」按钮，在附件按钮左侧新增「添加上下文」按钮
- [x] 3.2 空状态 CTA 改为打开 ContextInputDialog
- [x] 3.3 添加上下文按钮/enabled 逻辑：仅要求 `sessionId`，不要求 Provider ready
- [x] 3.4 删除 `DirectIngestPanel` 引用与 `directIngestOpen` 状态

## 4. 路由与重定向

- [x] 4.1 `wiki-routes.ts`：新增 `addContextHref` / `isAddContextRequested` / `clearAddContextQuery`；`directIngest` query 兼容映射到 `addContext`
- [x] 4.2 `WorkbenchLayout.tsx`：`/ingest` 与 `#ingest` 重定向到 `addContextHref()`
- [x] 4.3 `IngestChat.tsx`：mount 时检测 `addContext` query 并打开 Dialog，清除 query
- [x] 4.4 更新 `wiki-routes.test.ts`

## 5. 清理 DirectIngest

- [x] 5.1 删除 `DirectIngestPanel.tsx` 与 `direct-ingest-panel.test.tsx`
- [x] 5.2 更新 `ingest-chat.test.tsx`：移除 direct ingest 用例，新增 context append 用例
- [x] 5.3 更新 `app-nav.test.tsx`（如有 direct ingest 相关断言）

## 6. i18n 与文档

- [x] 6.1 更新 `zh.ts` / `en.ts`：新增 context 相关文案，移除 direct ingest 文案
- [x] 6.2 更新 `README.md` 摄入说明（上下文 + 归档，替代直接归档）

## 7. 验证

- [x] 7.1 运行 `web` 前端测试套件
- [x] 7.2 手动验证：添加上下文（无 LLM 回复）→ 归档 → Review 审阅；legacy `/ingest` 重定向；附件 .txt 仍走摘要
