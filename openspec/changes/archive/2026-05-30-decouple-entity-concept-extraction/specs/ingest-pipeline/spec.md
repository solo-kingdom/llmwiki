## ADDED Requirements

### Requirement: Entity-concept separation in ingest prompts
The ingest pipeline SHALL compose analysis and generation prompts that distinguish entities, concepts, and relations before planning wiki pages. The prompts MUST instruct the model to avoid creating concept pages whose titles bind a concrete entity name to a reusable abstract concept, unless the source material clearly establishes the combined phrase as a fixed proper term.

#### Scenario: Analysis separates entity and concept
- **WHEN** an ingest source discusses `AppLovin` and a reusable `组织裁剪方法论`
- **THEN** the analysis prompt SHALL ask the model to represent `AppLovin` as an entity candidate
- **AND** the analysis prompt SHALL ask the model to represent `组织裁剪方法论` as a concept candidate
- **AND** the analysis prompt SHALL ask the model to represent their connection as a relation or case relationship

#### Scenario: Generation avoids entity-bound concept title
- **WHEN** the generation step plans a concept page for a phrase shaped like `AppLovin组织裁剪方法论`
- **THEN** the generation prompt SHALL instruct the model to prefer a neutral concept page such as `wiki/concepts/组织裁剪方法论.md`
- **AND** the generation prompt SHALL instruct the model to link to the entity page such as `[[AppLovin]]` as a case or source-specific example when the source supports that relationship

#### Scenario: Prompt blueprint stays synchronized
- **WHEN** entity-concept separation rules are changed for runtime ingest prompts
- **THEN** the corresponding `skills/llmwiki-ingest` blueprint documents SHALL be updated with equivalent guidance
- **AND** both Chinese and English prompt paths SHALL preserve the same behavioral constraints
