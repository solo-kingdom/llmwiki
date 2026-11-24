export function wikiPageTemplateFiles(): Record<string, string> {
  return {
    "wiki/templates/entity.md": ENTITY_TEMPLATE_MD,
    "wiki/templates/concept.md": CONCEPT_TEMPLATE_MD,
    "wiki/templates/source.md": SOURCE_TEMPLATE_MD,
    "wiki/templates/synthesis.md": SYNTHESIS_TEMPLATE_MD,
    "wiki/templates/comparison.md": COMPARISON_TEMPLATE_MD,
    "wiki/templates/query.md": QUERY_TEMPLATE_MD,
  };
}

const ENTITY_TEMPLATE_MD = `---
title: 示例实体
type: entity
date: YYYY-MM-DD
tags: []
---

<!-- Required Sections: 概述、关键事实、相关概念、来源 -->

# 概述

（待填写）

## 关键事实

- （待填写）

## 相关概念

- [[相关概念]]

## 来源

- [[来源页面]]
`;

const CONCEPT_TEMPLATE_MD = `---
title: 示例概念
type: concept
date: YYYY-MM-DD
tags: []
---

<!-- Required Sections: 定义、核心要点、相关实体、来源 -->

# 定义

（待填写）

## 核心要点

- （待填写）

## 相关实体

- [[相关实体]]

## 来源

- [[来源页面]]
`;

const SOURCE_TEMPLATE_MD = `---
title: 示例来源
type: source
date: YYYY-MM-DD
tags: []
---

<!-- Required Sections: 摘要、关键观点、相关实体/概念 -->

# 摘要

（待填写）

## 关键观点

- （待填写）

## 相关实体/概念

- [[相关页面]]
`;

const SYNTHESIS_TEMPLATE_MD = `---
title: 示例综合
type: synthesis
date: YYYY-MM-DD
tags: []
---

<!-- Required Sections: 问题/目的、分析、引用、后续 -->

# 问题/目的

（待填写）

## 分析

（待填写）

## 引用

- [[引用页面]]

## 后续

- （待填写）
`;

const COMPARISON_TEMPLATE_MD = `---
title: 示例对比
type: comparison
date: YYYY-MM-DD
tags: []
---

<!-- Required Sections: 对比维度、异同、结论 -->

# 对比维度

（待填写）

## 异同

（待填写）

## 结论

（待填写）
`;

const QUERY_TEMPLATE_MD = `---
title: 示例问答
type: query
date: YYYY-MM-DD
tags: []
---

<!-- Required Sections: 问题、回答、引用 -->

# 问题

（待填写）

## 回答

（待填写）

## 引用

- [[引用页面]]
`;

export function templateGuidanceForGeneration(docLang: string): string {
  if (docLang === "en") {
    return `Page types (frontmatter \`type:\`) and required sections:
- entity: Overview, Key Facts, Related Concepts, Sources
- concept: Definition, Key Points, Related Entities, Sources
- source (must be under wiki/sources/): Summary, Key Points, Related Entities/Concepts
- synthesis: Question/Purpose, Analysis, References, Next Steps
- comparison: Comparison Dimensions, Similarities and Differences, Conclusion
- query: Question, Answer, References

Directory placement:
- Business pages (entity/concept/synthesis/comparison/query) are organized by knowledge topic into nested folders under wiki/ (e.g. wiki/AI工程/Agent/harness.md). Prefer reusing existing folders; create shallow new topic folders (2-3 levels max) only when needed.
- Source summaries MUST be written under wiki/sources/.
- Trailing reference sections (Related Entities/Concepts, Sources, References) are extracted into structured reference data on ingest and stripped from stored content — still generate them per template, as bullet lists of [[wikilinks]] with optional "— annotation" notes.

Business pages MUST NOT be written as top-level wiki/*.md files. Only wiki/overview.md, wiki/index.md, and wiki/log.md may live at the wiki root.
Use the corresponding template file under wiki/templates/ as the structural reference.`;
  }
  return `页面类型（frontmatter \`type:\`）与必需章节：
- entity：概述、关键事实、相关概念、来源
- concept：定义、核心要点、相关实体、来源
- source（必须放在 wiki/sources/）：摘要、关键观点、相关实体/概念
- synthesis：问题/目的、分析、引用、后续
- comparison：对比维度、异同、结论
- query：问题、回答、引用

目录放置规范：
- 业务知识页（entity/concept/synthesis/comparison/query）按知识主题组织在 wiki/ 下的多级目录中（如 wiki/AI工程/Agent/harness.md）；优先复用已有匹配目录，仅在无合适目录时新建浅层主题目录（建议 2–3 层）。
- 源摘要页必须写入 wiki/sources/。
- 尾部引用章节（相关实体/概念、来源、引用）会在入库时提取为结构化引用数据并从正文中剥离——仍按模板生成，写成 [[wikilink]] bullet 列表，可带「— 说明」标注。

业务知识页不得写入 wiki/ 顶层（仅允许 wiki/overview.md、wiki/index.md、wiki/log.md）。
参考 wiki/templates/ 下对应模板文件结构。`;
}
