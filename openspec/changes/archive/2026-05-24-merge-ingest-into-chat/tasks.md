## 1. DirectIngestPanel 组件

- [x] 1.1 从 `IngestRaw.tsx` 提取 `DirectIngestPanel.tsx`：文件上传区、多文本块、批次信息、提交摘要逻辑
- [x] 1.2 为 `DirectIngestPanel` 添加 `open` / `onOpenChange` props，使用 Dialog/Sheet 容器包裹表单内容
- [x] 1.3 保留 `data-testid` 语义（如 `direct-ingest-panel`、`direct-ingest-submit`）供测试使用

## 2. 嵌入 IngestChat

- [x] 2.1 在 `IngestChat.tsx` composer 工具栏新增「直接归档」按钮，点击打开 `DirectIngestPanel`
- [x] 2.2 空会话状态增加次要 CTA「直接归档材料」，点击打开同一面板
- [x] 2.3 提交成功后保留摘要展示，提供「查看 Jobs」跳转（`workbenchViewHref("jobs")`）

## 3. 路由与导航清理

- [x] 3.1 从 `WorkbenchView` 和 `wiki-routes.ts` 移除 `ingest` view；删除 `workbenchViewHref("ingest")` 路径
- [x] 3.2 `WorkbenchLayout.tsx` 移除 `IngestRaw` 渲染与 `ingest` nav 项
- [x] 3.3 `/ingest` 访问重定向到 `/` 并通过 query（如 `?directIngest=1`）自动打开面板；legacy `#ingest` hash 同样触发
- [x] 3.4 导航 label 统一：`nav.chat` 显示为 Ingest（zh: 摄入），移除 `nav.ingest`

## 4. 遗留代码清理

- [x] 4.1 删除 `IngestRaw.tsx`（逻辑已迁入 `DirectIngestPanel`）
- [x] 4.2 删除 `IngestHub.tsx` 及 `ingest.test.tsx` 中相关用例
- [x] 4.3 清理 `AppContext` 中仅被 `IngestHub` 使用的 `submitConversation`（若无其他引用）

## 5. i18n

- [x] 5.1 新增 direct ingest 相关文案（面板标题、composer 按钮、空状态 CTA）至 `zh.ts` / `en.ts`
- [x] 5.2 更新或移除 `ingest.raw.*` 键名（迁移至 `ingest.direct.*` 或复用现有键）

## 6. 测试

- [x] 6.1 将 `ingest-raw.test.tsx` 迁移为 `DirectIngestPanel` 单元测试
- [x] 6.2 更新 `app-nav.test.tsx`：断言无独立 Ingest Tab，Chat/Ingest 为默认入口
- [x] 6.3 更新 `wiki-routes.test.ts`：移除 ingest view，添加 `/ingest` 重定向测试
- [x] 6.4 在 `ingest-chat.test.tsx` 添加 composer 按钮打开面板与空状态 CTA 测试

## 7. 验证

- [x] 7.1 运行 `web` 前端测试套件确保全部通过
- [x] 7.2 手动验证：对话归档、直接归档直投、Jobs 跳转、legacy `/ingest` 重定向
