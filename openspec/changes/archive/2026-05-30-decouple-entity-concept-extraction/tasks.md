## 1. Prompt Blueprint And Runtime Prompts

- [x] 1.1 Update `skills/llmwiki-ingest/SKILL.zh.md` with entity/concept/relation definitions, naming rules, and the `AppLovin组织裁剪方法论` anti-pattern.
- [x] 1.2 Update `skills/llmwiki-ingest/SKILL.md` with equivalent English guidance so the skill blueprint stays synchronized.
- [x] 1.3 Update `internal/ingest/prompts.go` `StepAnalysis` prompts to require separate entity, concept, and relation candidates before page planning.
- [x] 1.4 Update `internal/ingest/prompts.go` `StepGeneration` prompts to prefer neutral concept titles and entity wikilinks for case relationships.
- [x] 1.5 Update organize/session prompts where needed so structure recommendations mention entity-concept coupling as a fixable warning.
- [x] 1.6 Add or update prompt composition tests in `internal/ingest/prompts_test.go` to assert the new separation and anti-pattern guidance is present.

## 2. Lint Detection

- [x] 2.1 Add lint code `entity_concept_coupling` to the engine lint issue constants.
- [x] 2.2 Implement entity prefix collection from existing `wiki/entities/` pages using title and filename stem variants.
- [x] 2.3 Implement concept title/stem normalization and abstract-keyword matching for `wiki/concepts/` pages.
- [x] 2.4 Emit a warning when a concept title appears to combine an existing entity prefix with abstract concept keywords.
- [x] 2.5 Keep the check non-destructive and exclude reserved/system pages from this semantic warning.

## 3. Diagnostics And Documentation

- [x] 3.1 Ensure `search(mode="lint")` includes `entity_concept_coupling` warnings in existing structured output without API changes.
- [x] 3.2 Ensure `audit(focus="structure")` surfaces the new warning with other structure issues.
- [x] 3.3 Update `skills/llmwiki-lint/SKILL.zh.md` to explain the new warning and recommended repair strategy.
- [x] 3.4 Update `skills/llmwiki-lint/SKILL.md` with equivalent English guidance.

## 4. Tests And Validation

- [x] 4.1 Add engine lint tests where `wiki/entities/AppLovin.md` plus `wiki/concepts/AppLovin组织裁剪方法论.md` reports `entity_concept_coupling`.
- [x] 4.2 Add engine lint tests where `wiki/concepts/组织裁剪方法论.md` linking `[[AppLovin]]` does not report the warning.
- [x] 4.3 Add tests for filename/title normalization variants such as underscores, spaces, and case differences.
- [x] 4.4 Run relevant Go tests for `internal/engine`, `internal/ingest`, and `internal/mcp`.
- [x] 4.5 Run `openspec status --change decouple-entity-concept-extraction` and confirm the change is apply-ready.
