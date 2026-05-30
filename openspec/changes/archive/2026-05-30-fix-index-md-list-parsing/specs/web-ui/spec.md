## ADDED Requirements

### Requirement: Index catalog table rendering
When the Wiki reader renders `wiki/index.md`, GFM tables in each typed section (entities, concepts, sources, etc.) SHALL display four distinct columns: page link, title, description summary, and update date.

#### Scenario: Index wikilink column renders as clickable link
- **WHEN** user opens `wiki/index.md` in the Wiki reader
- **AND** a table row contains a wikilink with GFM-escaped display separator (e.g. `[[entities/alpha\|Alpha Entity]]`)
- **THEN** the first column SHALL render a clickable link with display text `Alpha Entity`
- **AND** SHALL NOT show raw `[[` or `]]` syntax in the cell

#### Scenario: Index row shows title description and date
- **WHEN** user views an index table row generated from page frontmatter
- **THEN** the second column SHALL show the page title once
- **AND** the third column SHALL show the description summary
- **AND** the fourth column SHALL show the update date
- **AND** the title SHALL NOT be duplicated in the page link column beyond the link display text

#### Scenario: Typed section tables remain aligned
- **WHEN** user scrolls entities, concepts, or sources sections in `wiki/index.md`
- **THEN** each section table header row SHALL align with its data rows
- **AND** no extra columns SHALL appear due to wikilink pipe characters
