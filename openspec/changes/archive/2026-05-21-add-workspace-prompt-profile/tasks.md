## 1. Prompt 组合器

- [x] 1.1 新增 `internal/ingest/prompts.go`：`PromptStep` 枚举与 `PromptContext`（workspace, docLang, db supplement）
- [x] 1.2 实现 `FidelityInstruction(docLang)` 与中文/英文 LOCKED 格式段
- [x] 1.3 实现 `ComposeSystemPrompt(step, ctx)` 按 design 优先级拼接
- [x] 1.4 实现 `readTruncatedWorkspaceFile(rel, maxLen)` 与空文件跳过
- [x] 1.5 实现 `loadPromptAppends(workspace)` 解析 `.llmwiki/prompts.yaml`（仅 append）
- [x] 1.6 `prompts_test.go`：优先级、截断、append-only、supplement 注入

## 2. 工作区 Scaffold

- [x] 2.1 定义 `rules.md` 中文默认模板常量
- [x] 2.2 `init` / repair：`writeIfNotExists` 写入 `rules.md`
- [x] 2.3 可选：`writeIfNotExists` 写入 `.llmwiki/prompts.yaml` 注释示例
- [x] 2.4 init 测试：新 workspace 含 `rules.md`

## 3. Pipeline 接入

- [x] 3.1 `pipeline.go` analyze/generate 改用 `ComposeSystemPrompt` + 中文 user 消息标签
- [x] 3.2 `pipeline_review.go` plan/generateFromPlan 接入组合器
- [x] 3.3 `session_chat.go` 中文化 `ingestSessionSystemPrompt` 并接入组合器（或内联 DEFAULT 段）
- [x] 3.4 `AttachmentSummaryPrompt` 中文化 + 忠实性一句
- [x] 3.5 `rollback.go` system 与 user 框架接入组合器
- [x] 3.6 删除或委托冗余的 `languageInstructionForPipeline` 重复实现
- [x] 3.7 `pipeline_test.go` / `session_chat_test.go` 更新：断言中文 LOCKED 关键字与「源」相关约束

## 4. Settings API 与 UI

- [x] 4.1 `settingsResponse` 与 `allowedKeys` 增加 `rules_supplement`
- [x] 4.2 校验：长度 ≤2048；PUT 非法长度 400
- [x] 4.3 `settings_test.go` 读写 supplement
- [x] 4.4 可选 `GET /api/v1/workspace/rule-files` 返回 purpose/rules 预览
- [x] 4.5 `SettingsPage`「Wiki 规则」卡片：文件预览 + supplement 文本框 + 字数计数
- [x] 4.6 i18n：`settings.rules.*` 中英文词条
- [x] 4.7 `web` 类型与 `saveSettings` 透传 `rules_supplement`

## 5. Job 快照

- [x] 5.1 实现 `ComputeRulesHash(workspace, supplement)` 
- [x] 5.2 job 创建时写入 metadata `rules_hash`
- [x] 5.3 执行开始时可选记录 rules_drift 事件（info）

## 6. 验收

- [x] 6.1 `go test ./internal/ingest/... ./internal/api/...`
- [ ] 6.2 手工：Settings 填写 supplement → ingest → job events 中 prompt 含 supplement
- [ ] 6.3 手工：编辑 `rules.md` → 下次 ingest prompt 反映新规则（预览 API 可见）
