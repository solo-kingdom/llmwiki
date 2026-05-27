## MODIFIED Requirements

### Requirement: Wiki link parsing
The system SHALL parse both markdown links (`[text](path.md)`) and Obsidian-style double-bracket wikilinks (`[[target]]`) from wiki page content and create `links_to` edges in the reference graph.

#### Scenario: Absolute wiki link (markdown syntax)
- **WHEN** a wiki page contains `[See attention](/wiki/concepts/attention.md)`
- **THEN** a `links_to` edge SHALL be created from this page to the attention page

#### Scenario: Relative wiki link (markdown syntax)
- **WHEN** a wiki page at `/wiki/concepts/` contains `[details](./details.md)`
- **THEN** the system SHALL resolve to `concepts/details.md` and create a `links_to` edge

#### Scenario: Wiki link without extension (markdown syntax)
- **WHEN** a wiki page contains `[details](transformers)` and the page `transformers.md` exists
- **THEN** the system SHALL append `.md` and resolve to `transformers.md`

#### Scenario: External link ignored
- **WHEN** a wiki page contains `[external](https://example.com)` or `[anchor](#section)`
- **THEN** the system SHALL NOT create a reference graph edge

#### Scenario: Image link ignored
- **WHEN** a wiki page contains `![diagram](diagram.png)` or `[image](photo.jpg)`
- **THEN** the system SHALL NOT create a reference graph edge

#### Scenario: Double-bracket wikilink basic
- **WHEN** a wiki page contains `[[attention]]` and `wiki/concepts/attention.md` exists
- **THEN** a `links_to` edge SHALL be created from this page to the attention page

#### Scenario: Double-bracket wikilink with path
- **WHEN** a wiki page contains `[[concepts/attention]]` and `wiki/concepts/attention.md` exists
- **THEN** a `links_to` edge SHALL be created from this page to the attention page

#### Scenario: Double-bracket wikilink with display text
- **WHEN** a wiki page contains `[[concepts/attention|Attention Mechanism]]` and `wiki/concepts/attention.md` exists
- **THEN** a `links_to` edge SHALL be created using only the path part (`concepts/attention`), ignoring the display text

#### Scenario: Double-bracket wikilink target not found
- **WHEN** a wiki page contains `[[nonexistent]]` and no matching wiki page exists
- **THEN** the system SHALL NOT create a reference graph edge (silently ignored)

#### Scenario: Double-bracket wikilink without extension resolved
- **WHEN** a wiki page contains `[[transformers]]` and `wiki/concepts/transformers.md` exists
- **THEN** the system SHALL resolve by appending `.md` and create a `links_to` edge
