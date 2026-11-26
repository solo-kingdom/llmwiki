## Wiki 如何组织

业务知识页按 **页面类型** 存放在固定目录：

| 类型 | 目录 | 说明 |
|------|------|------|
| entity | `wiki/entities/` | 人物、组织、产品等实体 |
| concept | `wiki/concepts/` | 概念与术语 |
| source | `wiki/sources/` | 源文件摘要 |
| synthesis | `wiki/synthesis/` | 跨源综合分析 |
| comparison | `wiki/comparisons/` | 对比分析 |
| query | `wiki/queries/` | 归档的问答结果 |

保留的顶层系统页：`wiki/overview.md`（全局总览）、`wiki/index.md`（目录）、`wiki/log.md`（操作日志）。模板在 `wiki/templates/`，供生成参考而非业务内容。

### 常见错误布局

以下**不是**合法 canonical 布局：`wiki/purpose.md`、`wiki/rules.md`（应在工作区根）、`wiki/raw/`（raw 在工作区根）、单数目录 `wiki/entity/`、不存在的 `wiki/skills/`。Organize 模式若出现带 emoji 或 `root/` 包装的占位目录树，通常是 LLM 编造而非 `structure()` 工具返回。

### structure() 工具输出

Organize 模式应调用 `structure()` 获取目录。真实输出以 `# Wiki 目录结构` 开头，含工作区路径、`├── entities/ (N 页)` 等 typed 子目录行。示例格式见 `docs/workspace-layout.md`；**必须引用 tool 原始返回，不可自行绘制示例树**。

写入已有页面时默认 **合并** 而非覆盖：锁定 frontmatter 字段、数组合并、正文由 LLM 合并（可用 CLI `--force-overwrite` 恢复覆盖行为）。Wiki apply 成功后会自动重建 `wiki/index.md`；organize 模式的 move/merge 还会在 `wiki/log.md` 追加结构变更条目。
