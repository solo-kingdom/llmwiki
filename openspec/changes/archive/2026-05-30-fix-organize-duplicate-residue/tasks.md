## 1. Plan JSON Schema 扩展与 Prompt 更新

- [x] 1.1 更新 `internal/ingest/prompts.go` 中 `StepPlanOrganize` 的中文和英文 prompt，在 JSON schema 示例中增加 `from_path`、`to_path`（move）和 `source_paths`、`to_path`（merge）字段的示例和说明
- [x] 1.2 更新 `internal/ingest/prompts.go` 中 `StepPlanQA` 的中文和英文 prompt，同步增加 move/merge schema 示例（QA 模式也可能建议合并）
- [x] 1.3 新增 `internal/ingest/review_plan.go`，实现 `ParsePlanActions(planJSON string) []PlanAction` 函数，解析 plan JSON 提取 move/merge 动作的源路径和目标路径
- [x] 1.4 为 `ParsePlanActions` 编写测试：验证 move、merge、update 三种 action 的解析，以及新字段缺失时的 fallback 行为
- [x] 1.5 更新 `internal/ingest/prompts_test.go` 中 organize plan 相关测试，验证新 schema 示例出现在 prompt 中

## 2. Post-Apply DELETE 清理

- [x] 2.1 在 `internal/ingest/pipeline_review.go` 的 `generateFromPlan()` 中，LLM 生成 FILE blocks 后调用 `ParsePlanActions` 提取 move/merge 源路径
- [x] 2.2 为每个源路径注入 `---DELETE---` block 到 blocks map（跳过与 FILE block 目标重合的路径，跳过未通过 `NormalizeWikiFilePath` 验证的路径）
- [x] 2.3 将合并后的 blocks（写入 + 删除）传入 `ApplyWikiBlocks()`，单次调用完成
- [x] 2.4 在 post-apply cleanup 中记录 warning 日志（源路径验证失败时）和 recorder 事件（删除的文件列表）
- [x] 2.5 为 post-apply cleanup 编写测试：mock plan JSON + FILE blocks，验证 DELETE 注入、路径重合跳过、路径验证跳过

## 3. Lint duplicate_page 检测

- [x] 3.1 在 `internal/engine/lint.go` 中新增 `LintCodeDuplicatePage` 常量和 `lintDuplicatePages()` 函数
- [x] 3.2 实现 `lintDuplicatePages()`：按 typed 子目录分组，对每组内的文件名用 `normalizeNameKey()` 归一化后两两比较，相同则生成 `duplicate_page` warning
- [x] 3.3 在 `LintWorkspace()` 中调用 `lintDuplicatePages()`，放置在 `lintEntityConceptCoupling()` 之后
- [x] 3.4 在 `internal/mcp/diagnostic_tools.go` 的 `executeLocalAudit()` 中，为 `focus == "structure"` 和 `focus == "all"` 展示 `duplicate_page` issues
- [x] 3.5 为 `lintDuplicatePages` 编写测试：构造含 `A_Player文化.md` + `A Player文化.md` 的临时目录，验证 warning 报告；验证不同目录不互检

## 4. 深度整理 — 后端存储与 Plan 集成

- [x] 4.1 在 `internal/store/sqlite/ingest_reviews.go` 中为 `IngestReview` 结构体增加 `DeepOrganize bool` 字段
- [x] 4.2 添加数据库迁移：`ALTER TABLE ingest_reviews ADD COLUMN deep_organize BOOLEAN NOT NULL DEFAULT FALSE`
- [x] 4.3 更新 `ingest_reviews.go` 中所有 SQL 查询（Create/Get/List）以包含 `deep_organize` 列
- [x] 4.4 在 `internal/api/ingest_session.go` 的 `archiveSessionRequest` 中增加 `DeepOrganize bool` 字段，归档处理函数将其传入 review 创建
- [x] 4.5 在 `internal/ingest/review_processor.go` 的 `processReviewPlanJob()` 中读取 `review.DeepOrganize`，若为 true 则执行 FTS 内容相似度扫描，将结果注入 plan prompt
- [x] 4.6 编写后端测试：验证 archive API 接收 `deep_organize`、review 存储、plan job 读取的完整路径

## 5. 深度整理 — 前端 UI

- [x] 5.1 在 `web/src/components/IngestChat.tsx` 中为归档确认面板增加 `deepOrganize` state
- [x] 5.2 增加 checkbox UI，label 为翻译键 `chat.deep_organize`，仅 `sessionMode === "organize"` 时渲染
- [x] 5.3 修改 `handleArchive()` 将 `deepOrganize` 传入 `archiveSession` API 调用
- [x] 5.4 在 `web/src/i18n/messages/zh.ts` 和 `en.ts` 中增加翻译键：`chat.deep_organize`、`chat.deep_organize_hint`
- [x] 5.5 更新前端 context/api 层的 `archiveSession` 函数签名以支持新参数
- [x] 5.6 编写前端测试：验证 checkbox 仅在 organize 模式显示、API 调用包含正确参数
