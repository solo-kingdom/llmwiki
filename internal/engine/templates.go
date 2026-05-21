package engine

// WikiPageTemplateFiles maps workspace-relative paths to default wiki page templates.
func WikiPageTemplateFiles() map[string]string {
	return map[string]string{
		"wiki/templates/entity.md":     entityTemplateMD,
		"wiki/templates/concept.md":    conceptTemplateMD,
		"wiki/templates/source.md":     sourceTemplateMD,
		"wiki/templates/synthesis.md":  synthesisTemplateMD,
		"wiki/templates/comparison.md": comparisonTemplateMD,
		"wiki/templates/query.md":      queryTemplateMD,
	}
}

const entityTemplateMD = `---
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
`

const conceptTemplateMD = `---
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
`

const sourceTemplateMD = `---
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
`

const synthesisTemplateMD = `---
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
`

const comparisonTemplateMD = `---
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
`

const queryTemplateMD = `---
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
`

// TemplateGuidanceForGeneration returns page-type section requirements for the generation step.
func TemplateGuidanceForGeneration(docLang string) string {
	if docLang == "en" {
		return `Page types and required sections:
- entity (wiki/entities/): Overview, Key Facts, Related Concepts, Sources
- concept (wiki/concepts/): Definition, Key Points, Related Entities, Sources
- source (wiki/sources/): Summary, Key Points, Related Entities/Concepts
- synthesis (wiki/synthesis/): Question/Purpose, Analysis, References, Next Steps
- comparison (wiki/comparisons/): Comparison Dimensions, Similarities and Differences, Conclusion
- query (wiki/queries/): Question, Answer, References

Use the corresponding template file under wiki/templates/ as the structural reference.`
	}
	return `页面类型与必需章节：
- entity (wiki/entities/): 概述、关键事实、相关概念、来源
- concept (wiki/concepts/): 定义、核心要点、相关实体、来源
- source (wiki/sources/): 摘要、关键观点、相关实体/概念
- synthesis (wiki/synthesis/): 问题/目的、分析、引用、后续
- comparison (wiki/comparisons/): 对比维度、异同、结论
- query (wiki/queries/): 问题、回答、引用

参考 wiki/templates/ 下对应模板文件结构。`
}
