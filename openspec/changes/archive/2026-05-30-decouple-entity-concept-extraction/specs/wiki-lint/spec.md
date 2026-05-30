## ADDED Requirements

### Requirement: Entity-concept coupling lint
The wiki lint engine SHALL report a warning when a concept page appears to bind an existing entity name to an abstract concept title. The check SHALL be mechanical and non-destructive: it MUST NOT move, rewrite, delete, or rename pages.

#### Scenario: Existing entity name prefixes concept title
- **WHEN** `wiki/entities/AppLovin.md` exists
- **AND** `wiki/concepts/AppLovin组织裁剪方法论.md` exists
- **THEN** lint report SHALL include a warning with code `entity_concept_coupling`
- **AND** the issue SHALL identify the concept page as the affected path
- **AND** the issue message SHALL recommend using a neutral concept title and linking the entity as a case

#### Scenario: Neutral concept title is accepted
- **WHEN** `wiki/entities/AppLovin.md` exists
- **AND** `wiki/concepts/组织裁剪方法论.md` exists
- **AND** the concept page links to `[[AppLovin]]`
- **THEN** lint report SHALL NOT include `entity_concept_coupling` for that concept page

#### Scenario: Warning is shown through lint access paths
- **WHEN** an agent calls `search(mode="lint")` or organize diagnostics call `audit(focus="structure")`
- **THEN** `entity_concept_coupling` warnings SHALL be included with the other lint issues
- **AND** the warning SHALL remain lower priority than error-level issues such as dead links or missing frontmatter
