## 1. 创建 LLM Wiki Skill 综合参考文档

- [ ] 1.1 创建 `docs/15-llm-wiki-skill-reference.md`，撰写"跨实现 Skill 系统对比"章节：5 个参考实现的并列对比表（名称、Skill 格式、工作流数、交互模型、定位、技术栈）
- [ ] 1.2 撰写"本项目架构与 Skill 定位"章节：说明本项目 LLM 通过代码 prompt 驱动而非 SKILL.md，展示三元入口（MCP/HTTP/CLI）和两套工具体系（MCP tools vs Local tools）的架构图
- [ ] 1.3 撰写"Ingest 工作流详解"章节：完整步骤链（Session Chat → 归档 → 审核 → Apply → 写入 Wiki），映射 PromptStep（StepAnalysis → StepGeneration → StepMergeBody → StepRollback），列出 Local Tool 调用序列（search → read → references），与 nashsu 两步骤摄入的对比
- [ ] 1.4 撰写"Query 工作流详解"章节：QA 模式和 Organize 模式的区分（PromptStep 映射、温度/token 参数差异），工具调用顺序（search → read → references → audit/structure → gaps → similar），结果归档流程（StepPlan → StepGeneration）
- [ ] 1.5 撰写"Lint 工作流详解"章节：已实现检查项列表及代码位置（lint.go 的 6 个检查码），触发方式（MCP search lint / Local tool audit），与 Karpathy 原始概念的对应，未来阶段（矛盾检测、陈旧声明）
- [ ] 1.6 撰写"Prompt 系统设计映射"章节：9 个 PromptStep 与 Session 模式的完整映射表，`ComposeSystemPrompt()` 的叠加机制（格式契约 → 忠实性 → 任务指令 → purpose.md → rules.md → prompts.yaml → 补充规则 → 语言指令）
- [ ] 1.7 撰写"推荐工作流"章节：4 种使用场景（新建知识库、持续摄入、定期维护、深度问答）的推荐操作路径，面向 Web UI 用户

## 2. 扩充 Web UI Help 页面

- [ ] 2.1 在 `web/src/content/help.zh.md` 新增"Session 模式与摄入流程"章节：描述 chat/qa/organize 三种模式的区别和使用场景，对话→归档→审核卡片→确认计划的工作流
- [ ] 2.2 在 `web/src/content/help.zh.md` 新增"Wiki 健康检查"章节：说明 Lint 检查的 6 个检查项、触发方式、报告格式
- [ ] 2.3 在 `web/src/content/help.zh.md` 新增"推荐工作流"章节：4 种使用场景的简明操作路径
- [ ] 2.4 同步更新 `web/src/content/help.en.md`，将新增章节翻译为英文，保持与中文版结构一致

## 3. 验证与收尾

- [ ] 3.1 验证 `docs/14-gap-analysis-and-roadmap.md` 的已实现状态标记完整（P0-4 已标注 ✅，路线图已更新）
- [ ] 3.2 验证 `web/src/content/help.zh.md` 和 `help.en.md` 的 TOC 章节 ID 与 `web/src/content/help-sections.ts` 中的定义一致
- [ ] 3.3 验证新增 Help 内容在 Web UI 中正确渲染（运行 `npm run dev` 检查 Help 页面）
