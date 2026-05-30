## MODIFIED Requirements

### Requirement: Wiki index automatic generation
The system SHALL generate `wiki/index.md` deterministically from wiki page frontmatter during `llmwiki reindex` and initial `llmwiki init` reindex.

The generated index SHALL:

- Group entries by wiki subdirectory (entities, concepts, sources, synthesis, comparisons, queries)
- Exclude navigation pages: `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`
- Include columns: page wikilink, title, description summary, date
- Use Chinese section headings matching subdirectory purpose
- Include YAML frontmatter with `title`, `type: index`, and generation date
- Escape literal pipe characters (`|`) inside GFM table cell values as `\|` so wikilink display separators do not break column boundaries

#### Scenario: Reindex rebuilds index from wiki pages
- **WHEN** `llmwiki reindex` runs on a workspace with wiki pages under `wiki/entities/` and `wiki/concepts/`
- **THEN** the system writes `wiki/index.md` with entries grouped by subdirectory
- **AND** each entry reflects the page's frontmatter title and description

#### Scenario: Empty workspace index scaffold
- **WHEN** `llmwiki init` runs on a fresh workspace with no wiki content pages
- **THEN** `wiki/index.md` contains grouped section headers and empty tables in Chinese

#### Scenario: Index page indexed in SQLite
- **WHEN** reindex completes index generation
- **THEN** `wiki/index.md` is indexed in SQLite and searchable via FTS5

#### Scenario: Wikilink pipe escaped in table cells
- **WHEN** `llmwiki reindex` generates an index row with wikilink `[[entities/alpha|Alpha Entity]]`
- **THEN** the written markdown SHALL escape the wikilink display separator as `\|` (e.g. `[[entities/alpha\|Alpha Entity]]`)
- **AND** the row SHALL contain exactly four table columns: page wikilink, title, description, date

#### Scenario: Cell values with embedded pipes escaped
- **WHEN** a wiki page title or description contains a literal `|` character
- **THEN** the generated index table cell SHALL escape that character as `\|`
- **AND** the row SHALL remain parseable as four GFM columns
