## 1. 数据模型与会话存储

- [x] 1.1 在 SQLite 新增 `ingest_sessions` 与 `ingest_session_messages` 表（及 migration）
- [x] 1.2 实现会话目录初始化：`raw/sources/web-ingest/sessions/{id}/`
- [x] 1.3 实现消息与附件 manifest 的文件读写辅助函数

## 2. 摄入会话 API（后端）

- [x] 2.1 实现 `POST/GET /api/v1/ingest/sessions` 路由与 handler
- [x] 2.2 实现 `POST/GET .../sessions/{id}/messages` 追加与列表
- [x] 2.3 实现 `POST .../sessions/{id}/attachments` multipart 上传与校验
- [x] 2.4 实现 `POST .../sessions/{id}/archive`：生成 archive markdown、创建 `session_archive` ingest job
- [x] 2.5 为 session API 添加单元测试与错误语义（404/400）

## 3. LLM 流式与附件理解

- [x] 3.1 新增 ingest 会话专用 system prompt 与上下文组装
- [x] 3.2 实现 `POST .../messages` 触发的 SSE 流式助手回复并持久化
- [x] 3.3 附件上传后触发理解：图片摘要 / 文档 extract，写入 assistant 摘要消息
- [x] 3.4 处理流式超时、中断与 incomplete 消息状态

## 4. 摄入管线扩展

- [x] 4.1 扩展 `input_type=session_archive` 与 `NormalizeSessionArchive`
- [x] 4.2 确认 session archive job 走现有两步管线（分析 + 生成）
- [x] 4.3 添加 session archive 归一化与 job 处理的集成测试

## 5. 前端 API 与状态

- [x] 5.1 在 `web/src/lib/api.ts` 增加 session/message/attachment/archive/stream 客户端
- [x] 5.2 在 `AppContext` 增加活跃会话状态、消息列表与刷新逻辑
- [x] 5.3 更新 `web/src/types.ts` 会话与消息类型定义

## 6. Ingest 聊天 UI

- [x] 6.1 新建 `IngestChat` 组件：消息列表、用户/助手气泡、markdown 渲染
- [x] 6.2 实现 composer：发送、Shift+Enter 换行、附件按钮、拖放上传
- [x] 6.3 实现 SSE 流式渲染与错误重试 UI
- [x] 6.4 实现 **归档** 确认对话框与成功反馈（跳转 Jobs / 显示 job id）
- [x] 6.5 将 `App.tsx` 中 Ingest tab 接入 `IngestChat`，标签改为 `Ingest`
- [x] 6.6 移除或降级旧 `IngestHub` 主路径（保留必要测试迁移）

## 7. 导航与兼容

- [x] 7.1 更新全局导航文案：`Ingest Hub` → `Ingest`（含测试快照）
- [x] 7.2 将依赖警告 Popover 绑定到 Ingest 标签
- [x] 7.3 确认 legacy `POST /ingest/jobs/conversation` 仍可用且文档注明

## 8. 测试与验收

- [x] 8.1 前端：IngestChat 空状态、发送、归档禁用、归档成功路径测试
- [x] 8.2 端到端：创建会话 → 多轮对话 → 上传附件 → 归档 → job succeeded → wiki 有更新
- [x] 8.3 手动验收：长会话截断、附件失败 remediation、Jobs 页状态一致
