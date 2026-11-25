export function wikiPageTemplateFiles(): Record<string, string> {
  return {
    "wiki/templates/entity.md": ENTITY_TEMPLATE_MD,
    "wiki/templates/concept.md": CONCEPT_TEMPLATE_MD,
    "wiki/templates/source.md": SOURCE_TEMPLATE_MD,
    "wiki/templates/synthesis.md": SYNTHESIS_TEMPLATE_MD,
    "wiki/templates/comparison.md": COMPARISON_TEMPLATE_MD,
    "wiki/templates/query.md": QUERY_TEMPLATE_MD,
    "wiki/templates/experience.md": EXPERIENCE_TEMPLATE_MD,
    "wiki/templates/experience-pitfall.md": EXPERIENCE_PITFALL_TEMPLATE_MD,
    "wiki/templates/ledger.md": LEDGER_TEMPLATE_MD,
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
confidence: medium
sources: []
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

const EXPERIENCE_TEMPLATE_MD = `---
title: 示例经验
type: experience
kind: practice
date: YYYY-MM-DD
confidence: low
status: draft
sources: []
tags: []
---

<!-- Required Sections: 适用场景、触发信号、经验结论、预防与处理、验证方式、证据、边界与失效条件、来源 -->

# 适用场景

（待填写）

## 触发信号

- （待填写）

## 经验结论

（待填写）

## 预防与处理

- （待填写）

## 验证方式

（待填写）

## 证据

- （待填写）

## 边界与失效条件

（待填写）

## 来源

- [[来源页面]]
`;

const EXPERIENCE_PITFALL_TEMPLATE_MD = `---
title: 现象 → 根因
type: experience
kind: pitfall
date: YYYY-MM-DD
confidence: low
status: draft
symptoms: []
tags: []
sources: []
related: []
---

<!-- Required Sections: 适用场景、触发信号、误判与弯路、经验结论、最短判别、预防与处理、验证方式、证据、边界与失效条件、复发记录、来源 -->

# 适用场景

（待填写）

## 触发信号

- （待填写）

## 误判与弯路

（待填写）

## 经验结论

（待填写）

## 最短判别

1. （待填写）

## 预防与处理

- （待填写）

## 验证方式

（待填写）

## 证据

- （待填写）

## 边界与失效条件

（待填写）

## 复发记录

## 来源

- [[来源页面]]
`;

const LEDGER_TEMPLATE_MD = `---
title: 示例业务台账
type: ledger
date: YYYY-MM-DD
confidence: medium
status: active
tags: []
sources: []
---

<!-- Required Sections: 当前状态、历史、来源 -->

# 当前状态

（待填写）

## 历史

### [YYYY-MM-DD] 初始记录

- 状态：active
- 依据：[[来源页面]]

## 来源

- [[来源页面]]
`;

export function templateGuidanceForGeneration(docLang: string): string {
  if (docLang === "en") {
    return `Page types (frontmatter \`type:\`) and required sections:
- entity: Overview, Key Facts, Related Concepts, Sources
- concept: Definition, Key Points, Related Entities, Sources
- source (must be under wiki/sources/; include origin & captured_at): Summary, Key Points, Related Entities/Concepts
- synthesis: Question/Purpose, Analysis, References, Next Steps
- comparison: Comparison Dimensions, Similarities and Differences, Conclusion
- query: Question, Answer, References
- experience (with \`kind: practice | pitfall | pattern\`, \`status: draft | validated | deprecated\`, and \`symptoms\` for pitfall/pattern): Applicable Scenarios, Trigger Signals, Conclusion, Prevention & Handling, Verification, Evidence, Boundaries & Failure Conditions, Sources (pitfall/pattern also include Misconceptions & Detours, Shortest Discrimination; pitfall includes Recurrence Log)
- ledger (with \`status\`): Current State, History (append-only), Sources

Frontmatter metadata:
- Always include \`title\`, \`type\`, \`date\` (YYYY-MM-DD), \`confidence: high | medium | low\`, \`description\`, and \`sources: [...]\`.
- Use \`last_verified\` (required for \`confidence: high\` and \`status: validated\`), \`review_after\` (required for \`status: validated\` and volatile knowledge), and \`aliases: [...]\` when useful.
- Redact credentials, secrets, personal contacts, and internal hostnames as \`<REDACTED>\`.

Directory placement:
- Business pages (entity/concept/synthesis/comparison/query/experience/ledger) are organized by knowledge topic into nested folders under wiki/ (e.g. wiki/AI工程/Agent/harness.md). Prefer reusing existing folders; create shallow new topic folders (2-3 levels max) only when needed.
- Source summaries MUST be written under wiki/sources/.
- Trailing reference sections (Related Entities/Concepts, Sources, References) are extracted into structured reference data on ingest and stripped from stored content — still generate them per template, as bullet lists of [[wikilinks]] with optional "— annotation" notes.

Business pages MUST NOT be written as top-level wiki/*.md files. Only wiki/overview.md, wiki/index.md, and wiki/log.md may live at the wiki root.
Use the corresponding template file under wiki/templates/ as the structural reference.`;
  }
  return `页面类型（frontmatter \`type:\`）与必需章节：
- entity：概述、关键事实、相关概念、来源
- concept：定义、核心要点、相关实体、来源
- source（必须放在 wiki/sources/，带 origin 与 captured_at）：摘要、关键观点、相关实体/概念
- synthesis：问题/目的、分析、引用、后续
- comparison：对比维度、异同、结论
- query：问题、回答、引用
- experience（带 \`kind: practice | pitfall | pattern\`、\`status: draft | validated | deprecated\`；pitfall/pattern 需带 \`symptoms\` 现象词）：适用场景、触发信号、经验结论、预防与处理、验证方式、证据、边界与失效条件、来源（pitfall/pattern 另加「误判与弯路」「最短判别」；pitfall 另加「复发记录」）
- ledger（带 \`status\`）：当前状态、历史（仅追加）、来源

Frontmatter 元数据：
- 必填 \`title\`、\`type\`、\`date\`（YYYY-MM-DD）、\`confidence: high | medium | low\`、\`description\`、\`sources: [...]\`。
- \`confidence: high\` 或 \`experience.status: validated\` 必须填写 \`last_verified\`；\`validated\` 经验及易变知识必须填写 \`review_after\`；常用别名可填 \`aliases: [...]\`。
- 凭据、密钥、个人联系方式、内部主机名统一脱敏为 \`<REDACTED>\`，不入库。

目录放置规范：
- 业务知识页（entity/concept/synthesis/comparison/query/experience/ledger）按知识主题组织在 wiki/ 下的多级目录中（如 wiki/AI工程/Agent/harness.md）；优先复用已有匹配目录，仅在无合适目录时新建浅层主题目录（建议 2–3 层）。
- 源摘要页必须写入 wiki/sources/。
- 尾部引用章节（相关实体/概念、来源、引用）会在入库时提取为结构化引用数据并从正文中剥离——仍按模板生成，写成 [[wikilink]] bullet 列表，可带「— 说明」标注。

业务知识页不得写入 wiki/ 顶层（仅允许 wiki/overview.md、wiki/index.md、wiki/log.md）。
参考 wiki/templates/ 下对应模板文件结构。`;
}
