## ADDED Requirements

### Requirement: Semantic boundary between entity and concept pages
The typed wiki organization contract SHALL define a semantic boundary between entity pages and concept pages. Entity pages SHALL describe concrete objects such as people, organizations, products, and projects. Concept pages SHALL describe reusable terms, methods, frameworks, mechanisms, theories, or models that can be linked from multiple entities or sources.

#### Scenario: Concrete organization belongs to entity page
- **WHEN** the wiki stores knowledge about a concrete company such as `AppLovin`
- **THEN** the canonical page for that object SHALL be an entity page under `wiki/entities/`

#### Scenario: Reusable method belongs to concept page
- **WHEN** the wiki stores knowledge about a reusable method such as `组织裁剪方法论`
- **THEN** the canonical page for that abstraction SHALL be a concept page under `wiki/concepts/`

#### Scenario: Entity-specific case links to reusable concept
- **WHEN** a concrete entity is an example or practitioner of a reusable concept
- **THEN** the entity page and concept page SHALL be connected through wikilinks
- **AND** the organization contract SHALL prefer a neutral concept title rather than embedding the entity name

### Requirement: Concept page naming avoids entity binding
Concept page titles and filenames SHALL avoid combining an existing entity name with an abstract concept label by default. If the source establishes the combined phrase as a fixed proper term, the page MUST explain that naming basis in the body or source context.

#### Scenario: Entity-bound concept name is discouraged
- **WHEN** a candidate concept title is shaped as `AppLovin组织裁剪方法论`
- **THEN** the organization contract SHALL prefer the neutral concept title `组织裁剪方法论`
- **AND** the page body SHALL link `[[AppLovin]]` as the relevant case or source context

#### Scenario: Proper term exception
- **WHEN** a source explicitly treats an entity-prefixed phrase as a fixed proper term
- **THEN** the wiki SHALL allow preserving the combined title
- **AND** the page SHALL include source-backed context explaining why the combined name is retained
