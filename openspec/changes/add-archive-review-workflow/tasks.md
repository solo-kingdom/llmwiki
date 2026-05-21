## 1. Plan 格式定义与模板

- [ ] 1.1 定义 `plan.md` 模板：6 个必需字段（File, Action, Current state, Target state, Rationale, Verification） + 可选字段（Risk, Dependencies）
- [ ] 1.2 定义 `plan.log.md` 仅追加日志格式：时间戳 + Action + 受影响步骤
- [ ] 1.3 定义 `lint_report.md` 输出格式：检查项通过/失败统计 + 逐项详情
- [ ] 1.4 定义 `review_report.md` 输出格式：Overall Assessment + Issues Found 表 + Coverage Analysis 表

## 2. Plan 生成 — 扩展 archive skill (Phase 2)

- [ ] 2.1 在 `openspec-archive-change` skill 中，Phase 1 归档完成后不终止，触发 Phase 2
- [ ] 2.2 实现上下文收集：自动读取 `[proposal, design, specs/*].md` + 扫描当前代码库结构
- [ ] 2.3 实现 plan 生成 prompt：要求输出具体文件路径、操作类型、前后状态对比、理由、验证方式
- [ ] 2.4 生成 `plan.md` 到归档目录 `openspec/changes/archive/YYYY-MM-DD-name/plan.md`
- [ ] 2.5 初始化 `plan.log.md`，写入首条 "Plan Created" 记录

## 3. 机械检查 — Lint (Phase 2 自动检查)

- [ ] 3.1 创建 `scripts/lint_plan.py`：读取 plan.md，执行确定性检查
- [ ] 3.2 实现 `check_file_refs`：每个步骤是否引用至少一个文件路径
- [ ] 3.3 实现 `check_file_exists`：声明文件在代码库中是否真实存在
- [ ] 3.4 实现 `check_deps`：提取步骤依赖，拓扑排序验证无循环
- [ ] 3.5 实现 `check_structure`：必需字段（File, Action, Rationale, Verification）是否齐全
- [ ] 3.6 实现 `check_no_duplicates`：步骤标题/操作是否有明显重复
- [ ] 3.7 实现 `check_coverage`：specs/ 中所有 requirement 至少被一个步骤覆盖（解析 spec.md 中的 requirement 标记）
- [ ] 3.8 输出 `lint_report.md`，返回退出码（0 = 全通过，1 = 有 error，2 = 有 warning）

## 4. 双模型审核 (Phase 2 自动检查，可选)

- [ ] 4.1 在 `openspec/config.yaml` 新增 `review` 配置段：`enabled`, `model`, `provider`, `api_base`
- [ ] 4.2 创建 `scripts/review_plan.py`：确定性 prompt 构建 + LLM API 调用
- [ ] 4.3 实现审核上下文收集：读取 proposal + design + specs + plan.md，显式排除对话历史
- [ ] 4.4 实现审核 prompt：要求评估 completeness, correctness, risk, efficiency，逐步骤审视
- [ ] 4.5 适配多 Provider API（anthropic/openai/deepseek/custom），通过 config 切换
- [ ] 4.6 实现 `review.enabled` 三种模式：`true`（自动）/ `false`（跳过）/ `"ask"`（询问）
- [ ] 4.7 实现审核失败降级：API 调用失败时写 warning 到 stdout，不阻断 Phase 3
- [ ] 4.8 从环境变量 `OPENSPEC_REVIEW_API_KEY` 读取 API key，不透出到日志或输出

## 5. 人工审核 — 对话交互 (Phase 3)

- [ ] 5.1 在 archive skill 中实现 Phase 3 入口：展示 plan 概览（步骤数、文件数、风险级别）
- [ ] 5.2 实现 skip 快捷出口：用户选"直接执行"即跳过审核，进入 Phase 4
- [ ] 5.3 实现逐项审核对话：人类可针对特定步骤提问/修改/删除/新增
- [ ] 5.4 实现 plan 修改循环：每次修改 → 更新 plan.md → 追加 plan.log.md
- [ ] 5.5 实现 re-lint 选项：修改后可选择重新运行机械检查
- [ ] 5.6 实现 re-review 选项：修改后可选择重新运行双模型审核
- [ ] 5.7 实现最终确认：用户说"确认"后锁定 plan，进入 Phase 4

## 6. 执行 (Phase 4)

- [ ] 6.1 在 archive skill 中实现 Phase 4：按 plan.md 逐步骤执行
- [ ] 6.2 每步完成后标记 `[x]`，展示进度 "N/M steps complete"
- [ ] 6.3 实现执行中断处理：遇到错误/阻塞时暂停，给用户选择（重试/跳过/修改 plan）
- [ ] 6.4 实现轻量变更处理：实现方式微调原地修正 plan.md + plan.log.md
- [ ] 6.5 实现重大变更处理：新增/删除步骤 → 回退到 Phase 3 重新人工确认

## 7. 验收与关闭 (Phase 5)

- [ ] 7.1 实现完成检查：对照 plan.md 验证所有步骤均已标记完成
- [ ] 7.2 实现 specs 对照检查：与 specs/ 中 requirement 做最终比对
- [ ] 7.3 在 plan.md 末尾追加 "## Execution Summary"（执行时间、完成步骤数、遇到的坑）
- [ ] 7.4 在 plan.log.md 追加最终 "Execution Complete" 记录
- [ ] 7.5 展示归档完成摘要（change 名、schema、归档位置、plan 状态、审核状态）

## 8. 测试与验证

- [ ] 8.1 端到端测试：创建假 change → 归档 → 生成 plan → 跳过审核 → 执行 → 关闭
- [ ] 8.2 端到端测试：同上链路 + 对话审核修改 + 重新确认 + 执行
- [ ] 8.3 lint 脚本测试：构造有效/无效 plan.md，验证退出码和报告内容
- [ ] 8.4 双模型审核测试：验证审核脚本在不同 provider 下正常工作
- [ ] 8.5 降级测试：审核 API 不可用时流程正常继续
- [ ] 8.6 执行中断测试：模拟步骤失败，验证回退到 Phase 3 的流程
