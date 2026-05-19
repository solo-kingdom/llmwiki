## ADDED Requirements

### Requirement: Citation parsing from footnotes
The system SHALL parse footnote-style citations (`[^N]: file.pdf, p.3`) from wiki page content and create `cites` edges in the reference graph.

#### Scenario: Citation with page number
- **WHEN** a wiki page contains `[^1]: paper.pdf, p.3`
- **THEN** a `cites` edge SHALL be created from the wiki page to `paper.pdf` with page=3

#### Scenario: Citation without page number
- **WHEN** a wiki page contains `[^1]: notes.md`
- **THEN** a `cites` edge SHALL be created with page=NULL

#### Scenario: Citation target resolution via extension fallback
- **WHEN** a citation references `somefile` (no extension) and the workspace contains `somefile.pdf`
- **THEN** the system SHALL resolve the citation to `somefile.pdf` by stripping extensions from both and matching base names

### Requirement: Wiki link parsing
The system SHALL parse markdown wiki links (`[text](path.md)`) from wiki page content and create `links_to` edges in the reference graph.

#### Scenario: Absolute wiki link
- **WHEN** a wiki page contains `[See attention](/wiki/concepts/attention.md)`
- **THEN** a `links_to` edge SHALL be created from this page to the attention page

#### Scenario: Relative wiki link
- **WHEN** a wiki page at `/wiki/concepts/` contains `[details](./details.md)`
- **THEN** the system SHALL resolve to `concepts/details.md` and create a `links_to` edge

#### Scenario: Wiki link without extension
- **WHEN** a wiki page contains `[details](transformers)` and the page `transformers.md` exists
- **THEN** the system SHALL append `.md` and resolve to `transformers.md`

#### Scenario: External link ignored
- **WHEN** a wiki page contains `[external](https://example.com)` or `[anchor](#section)`
- **THEN** the system SHALL NOT create a reference graph edge

#### Scenario: Image link ignored
- **WHEN** a wiki page contains `![diagram](diagram.png)` or `[image](photo.jpg)`
- **THEN** the system SHALL NOT create a reference graph edge

### Requirement: Reference graph deduplication
The system SHALL enforce uniqueness on `(source_document_id, target_document_id, reference_type)` to prevent duplicate edges.

#### Scenario: Duplicate citation ignored
- **WHEN** a wiki page cites the same source file twice (e.g., `[^1]: paper.pdf` and `[^2]: paper.pdf, p.5`)
- **THEN** only ONE `cites` edge SHALL exist from this wiki page to paper.pdf

### Requirement: Staleness propagation
When a wiki page is updated, the system SHALL mark all pages that link to it via `links_to` edges as stale.

#### Scenario: Linked page becomes stale
- **WHEN** page B (referenced by page A via `links_to`) is updated
- **THEN** page A's `stale_since` SHALL be set to the current timestamp

#### Scenario: Citation does not trigger staleness
- **WHEN** a source file is updated (referenced by a wiki page via `cites`)
- **THEN** the citing wiki page's `stale_since` SHALL NOT change

#### Scenario: Already stale page not re-stamped
- **WHEN** page A is already marked stale and page B is updated again
- **THEN** page A's `stale_since` SHALL keep its original timestamp (not overwritten)

### Requirement: Reference graph rebuild on reindex
The system SHALL rebuild the entire reference graph during reindex by re-parsing all wiki pages' citations and links.

#### Scenario: Reindex restores references
- **WHEN** the database is deleted and reindex runs
- **THEN** all `cites` and `links_to` edges SHALL be reconstructed from wiki page content
