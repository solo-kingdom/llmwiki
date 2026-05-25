## 1. LLM reasoning_content 支持

- [x] 1.1 在 `llm.Message` 与 `ChatResult` 增加 `ReasoningContent` 字段及 JSON 序列化
- [x] 1.2 在 `parseChatResponse` OpenAI 兼容分支解析 `reasoning_content`
- [x] 1.3 更新 `RunToolLoop`：append assistant 消息时保留 `ReasoningContent`
- [x] 1.4 更新 `RunSessionChatToolLoop`（若独立 append 路径）同样回传 reasoning
- [x] 1.5 添加单元测试：mock 响应含 reasoning_content + tool_calls 时第二轮请求体包含该字段

## 2. Wiki FILE 路径规范化

- [x] 2.1 实现 `NormalizeWikiFilePath`（entity/concept/source 等简写 → `wiki/<dir>/`）
- [x] 2.2 在 `parseFileBlocksWithContent` 或 `ApplyWikiBlocks` 入口应用规范化
- [x] 2.3 无法规范化时返回明确错误，不再静默 `continue`
- [x] 2.4 添加 `fileblocks_test.go` 覆盖各简写与已有 `wiki/` 路径

## 3. 零写入失败语义

- [x] 3.1 定义 `errNoWikiFilesWritten` 并在 pipeline/review apply 检测 `len(blocks)>0 && len(written)==0`
- [x] 3.2 `processReviewApplyJob` 零写入时调用 `failReviewApplyFailed`，error_code `no_wiki_files_written`
- [x] 3.3 常规 ingest apply 路径同样失败（非仅 review）
- [x] 3.4 零写入时不更新 `merge_commit_sha`、不标 review/job succeeded
- [x] 3.5 添加 review processor 测试：mock FILE 块路径经规范化后写入或零写入失败

## 4. 提示词补强

- [x] 4.1 `lockedFormatInstruction(StepGeneration)` 明确要求 `wiki/` 前缀示例
- [x] 4.2 plan 步骤 JSON 示例统一为 `wiki/entities/...` 路径

## 5. 前端审阅卡片

- [x] 5.1 `ArchiveReviewCard`：`failed` + `no_wiki_files_written` 或 0 页摘要时显示失败态与 remediation
- [x] 5.2 成功态仅在写入页数 > 0 时显示「已写入 wiki」类文案
- [x] 5.3 更新相关前端测试（若有）

## 6. 验证

- [ ] 6.1 本地用 DeepSeek thinking 模型跑完整归档：tool loop 无 400、job 事件无 reasoning warn（或仅首轮后成功）
- [ ] 6.2 确认 apply 后 `wiki/entities/` 等目录有新文件，`wiki/log.md` 或 index 更新
- [ ] 6.3 对 `/Users/wii/tmp/lwk3` 失败会话可重新 approve 并成功写入（手动验证）
