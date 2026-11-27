export function templateGuidanceForGeneration(docLang: string): string {
  if (docLang === "en") {
    return `Page types (frontmatter \`type:\`) and required sections:
- entity: Overview, Key Facts, Related Concepts, Sources
- concept: Definition, Key Points, Related Entities, Sources
- source (include origin & captured_at): Summary, Key Points, Related Entities/Concepts
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
- Business pages (entity/concept/synthesis/comparison/query/experience/ledger) are organized by knowledge topic into lowercase kebab-case folders under wiki/ (e.g. wiki/ai-agent/agent-runtime/harness.md). Prefer reusing existing folders; create shallow new topic folders (2 levels) only when needed.
- Raw sources are stored in archives (not wiki/sources/ summary pages).
- Trailing reference sections (Related Entities/Concepts, Sources, References) are extracted into structured reference data on ingest and stripped from stored content — still generate them per template, as bullet lists of [[wikilinks]] with optional "— annotation" notes.

Business pages MUST NOT be written as top-level wiki/*.md files (only wiki/overview.md and folder _overview.md serve as pyramid navigation pages).`;
  }
  return `页面类型（frontmatter \`type:\`）与必需章节：
- entity：概述、关键事实、相关概念、来源
- concept：定义、核心要点、相关实体、来源
- source（带 origin 与 captured_at）：摘要、关键观点、相关实体/概念
- synthesis：问题/目的、分析、引用、后续
- comparison：对比维度、异同、结论
- query：问题、回答、引用
- experience（带 \`kind: practice | pitfall | pattern\`、\`status: draft | validated | deprecated\`；pitfall/pattern 需带 \`symptoms\` 现象词）：适用场景、触发信号、经验结论、预防与处理、验证方式、证据、边界与失效条件、来源（pitfall/pattern 另加「误判与弯路」「最短判别」；pitfall 另加「复发记录」）
- ledger（带 \`status\`）：当前状态、历史（仅追加）、来源

Frontmatter 元数据：
- 必填 \`title\`、\`type\`、\`date\`（YYYY-MM-DD）、\`confidence: high | medium | low\`、\`description\`、\`tags: [...]\`（2–5 个规范标签）、\`sources: [...]\`。
- \`confidence: high\` 或 \`experience.status: validated\` 必须填写 \`last_verified\`（首次自动生成默认 \`medium\`，勿自标 \`high\`）；\`validated\` 经验及易变知识必须填写 \`review_after\`；常用别名可填 \`aliases: [...]\`。
- 凭据、密钥、个人联系方式、内部主机名统一脱敏为 \`<REDACTED>\`，不入库。

目录放置规范：
- 业务知识页（entity/concept/synthesis/comparison/query/experience/ledger）按知识主题组织在 wiki/ 下的全英文小写 kebab-case 主题域/主题组目录中（如 wiki/ai-agent/agent-runtime/harness.md）；优先复用已有匹配目录。
- 原始来源由档案库（archives）唯一承载，不再自动生成 wiki/sources/ 摘要页。
- 尾部引用章节（相关实体/概念、来源、引用）会在入库时提取为结构化引用数据并从正文中剥离——仍按模板生成，写成 [[wikilink]] bullet 列表，可带「— 说明」标注。

业务知识页不得写入 wiki/ 顶层（仅 wiki/overview.md 与各组 _overview.md 作为金字塔导航页）。`;
}
