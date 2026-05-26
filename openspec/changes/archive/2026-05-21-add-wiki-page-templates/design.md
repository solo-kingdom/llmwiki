## Context

Skilled 模板示例（entity）:
- Overview, Key Facts, Related Concepts, Sources

OmegaWiki 按 9 种实体定义精确章节。本项目通用 6 类即可。

## Goals / Non-Goals

**Goals:**

- LLM 生成页面有 predictable section 结构
- 中文 section 标题（doc_language=zh 默认）
- 模板随 init 创建，用户可编辑

**Non-Goals:**

- Go template 引擎渲染
- 强制 lint 所有 section（首版 soft prompt only）

## Decisions

### Decision 1: 模板目录

```
wiki/templates/
├── entity.md
├── concept.md
├── source.md
├── synthesis.md
├── comparison.md
└── query.md
```

每个模板含：
- YAML frontmatter 示例
- Required Sections 注释
- 中文 section 占位

### Decision 2: Prompt 注入

`generate()` systemMsg 追加：

```
页面类型与必需章节：
- entity (wiki/entities/): 概述、关键事实、相关概念、来源
- concept (wiki/concepts/): 定义、核心要点、相关实体、来源
...
参考 wiki/templates/ 下对应模板文件结构。
```

不将整个模板内容塞入 prompt（token 节省），只注入 section 列表 + 路径提示。LLM 可通过 MCP read 读取完整模板。

### Decision 3: Init 集成

`fix-workspace-scaffold-zh` 若未含 templates/，本 change 补全：
- 创建 `wiki/templates/` 目录
- 写入 6 个模板文件（writeIfNotExists）

## Risks

| 风险 | 缓解 |
|------|------|
| 模板过 rigid 限制 LLM | Required Sections 为 guidance 非 hard lint |
| prompt 过长 | 只注入 section 摘要 |
