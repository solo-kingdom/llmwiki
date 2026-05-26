## 1. 组织契约基础

- [x] 1.1 在 `internal/engine` 增加共享 typed wiki path classification helper，覆盖 typed dirs、reserved top-level pages、system template dirs、misplaced pages 判定
- [x] 1.2 为 path classification 添加单元测试，覆盖 `wiki/entities/x.md`、`wiki/dsp.md`、`wiki/overview.md`、`wiki/templates/entity.md`、未知子目录
- [x] 1.3 用共享 helper 替换 `WikiPageType`、lint、index、MCP 诊断中重复的目录/type 字符串判断

## 2. 写入与生成约束

- [x] 2.1 更新 `ApplyWikiBlocks` 路径校验，拒绝 `wiki/*.md` 顶层业务页并保留 `wiki/overview.md`、`wiki/index.md`、`wiki/log.md`
- [x] 2.2 更新 `ApplyWikiBlocks` 路径校验，拒绝 ingest 输出覆盖 `wiki/templates/` 系统模板文件
- [x] 2.3 为 FILE 块应用添加测试，验证 typed path accepted、reserved top-level accepted、top-level business rejected、template target rejected
- [x] 2.4 更新 generation prompt/template guidance，明确 page type 到 typed directory 的映射
- [x] 2.5 补充 `doc_language=zh/en` prompt 测试，验证组织规则和默认生成语言同时出现在 generation/plan/organize 相关提示中

## 3. Lint、Index 与诊断

- [x] 3.1 扩展 lint issue code，新增 `misplaced_wiki_page`
- [x] 3.2 更新 lint 扫描逻辑，报告既有 `wiki/*.md` 顶层业务页且不自动移动或修改文件
- [x] 3.3 更新 lint 逻辑，排除 `wiki/templates/` 的孤立页检查与业务 type-dir 校验
- [x] 3.4 为 misplaced page detection 添加测试，覆盖有 frontmatter type 时的建议目录
- [x] 3.5 更新 `IndexBuilder` 和 reindex 相关测试，确保 `wiki/templates/` 与 misplaced top-level pages 不进入 typed content groups
- [x] 3.6 更新 organize mode 的 structure/audit 输出，区分系统模板目录、typed content pages 与 misplaced pages

## 4. 语言设置一致性

- [x] 4.1 确认所有 wiki 生成/重组步骤都通过 `ComposeSystemPrompt` 或同等路径接收 `doc_language`
- [x] 4.2 更新 session archive plan、organize plan、rollback、merge body 的语言指令测试，确保默认文本语言服从 `doc_language`
- [x] 4.3 检查中文/英文模板指导文案，避免 UI 语言或硬编码中文覆盖文档语言设置

## 5. 验证与回归

- [x] 5.1 运行 Go 单元测试，至少覆盖 `internal/engine`、`internal/ingest`、`internal/mcp`
- [x] 5.2 运行 OpenSpec 校验，确认新增 capability 与 modified specs 可归档
- [x] 5.3 手动验证旧 workspace 场景：存在 `wiki/dsp.md` 时 lint/audit 报告 misplaced，但文件不被移动或改写
- [x] 5.4 手动验证新 ingest 场景：LLM 输出 `wiki/dsp.md` 时 job 失败并给出允许 typed 目录提示
