## MODIFIED Requirements

### Requirement: Wiki link parsing
The system SHALL parse both markdown links (`[text](path.md)`) and Obsidian-style double-bracket wikilinks (`[[target]]`) from wiki page content and create `links_to` edges in the reference graph. The `resolveWikiPath` function SHALL use a five-step resolution strategy: exact match → append `.md` → basename match → slug normalization match → title/filename index match.

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
- **WHEN** a wiki page contains `[[nonexistent]]` and no matching wiki page exists after all five resolution strategies
- **THEN** the system SHALL NOT create a reference graph edge (silently ignored)

#### Scenario: Double-bracket wikilink without extension resolved
- **WHEN** a wiki page contains `[[transformers]]` and `wiki/concepts/transformers.md` exists
- **THEN** the system SHALL resolve by appending `.md` and create a `links_to` edge

#### Scenario: Double-bracket wikilink resolved via slug normalization
- **WHEN** a wiki page contains `[[Adam Foroughi]]` and `wiki/entities/adam-foroughi.md` exists
- **THEN** the system SHALL slugify the target to `adam-foroughi`, match via slug index, and create a `links_to` edge

#### Scenario: Double-bracket wikilink resolved via title index
- **WHEN** a wiki page contains `[[Adam Foroughi]]` and a document with title "Adam Foroughi" exists but slug normalization did not match
- **THEN** the system SHALL resolve via the title/filename index and create a `links_to` edge
