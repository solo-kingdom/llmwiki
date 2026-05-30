## ADDED Requirements

### Requirement: Organize session structure output fidelity instruction
The composed prompt for `StepSessionOrganize` SHALL include a locked instruction requiring the model to quote or faithfully reproduce the `structure` tool output when describing wiki directory layout, and prohibiting fabricated example trees or placeholder filenames.

#### Scenario: Chinese organize prompt includes fidelity rule
- **WHEN** `ComposeSystemPrompt(session_organize, ctx)` runs with `doc_language=zh`
- **THEN** the task instruction SHALL state that wiki directory structure must come from the `structure` tool return
- **AND** SHALL prohibit drawing generic directory trees or using placeholder page names not present in tool output

#### Scenario: English organize prompt includes fidelity rule
- **WHEN** `ComposeSystemPrompt(session_organize, ctx)` runs with `doc_language=en`
- **THEN** the English task instruction SHALL include the equivalent structure fidelity constraint

#### Scenario: Skills blueprint stays synchronized
- **WHEN** organize session prompt fidelity rules change
- **THEN** `skills/llmwiki-query/SKILL.md` and `skills/llmwiki-query/SKILL.zh.md` SHALL document the same workflow constraint as the Go prompt implementation
