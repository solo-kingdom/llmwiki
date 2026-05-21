# chat-wiki-context Specification

## Purpose
Provide wiki-aware context for ingest session chat: reference tracking, related subset resolution, readonly chat tools, and archive export of referenced pages.
## Requirements
### Requirement: Session wiki reference tracking
The system SHALL persist wiki pages referenced during an ingest session in `ingest_session_references`, keyed by `(session_id, document_id)` with fields `relative_path`, `title`, `source`, and `first_seen_at`.

#### Scenario: Record user mention reference
- **WHEN** a session message is sent with `wiki_refs` containing a valid wiki document
- **THEN** the system SHALL upsert a reference row with `source=user_mention`

#### Scenario: Record tool read reference
- **WHEN** session chat tool loop executes `read` on a wiki document path
- **THEN** the system SHALL upsert a reference row with `source=tool_read`

#### Scenario: Graph subset does not auto-record
- **WHEN** ContextResolver includes a page in the related subset index only
- **THEN** the system SHALL NOT add that page to `ingest_session_references` unless it is user-mentioned or tool-read

### Requirement: ContextResolver related subset
The system SHALL compute a per-turn related wiki subset using FTS seeds, graph expansion, and lint filtering before assembling session chat LLM messages.

#### Scenario: Seed from user query and wiki refs
- **WHEN** assembling chat messages for a user turn with non-empty content and/or `wiki_refs`
- **THEN** the resolver SHALL use `wiki_refs` and FTS search hits (wiki documents only, default limit 5) as seeds

#### Scenario: Graph expansion
- **WHEN** seeds are resolved
- **THEN** the resolver SHALL expand via `links_to` edges up to depth 2 with a maximum of 20 candidate nodes

#### Scenario: Lint filtering
- **WHEN** candidates include paths flagged as dead_link targets by wiki lint
- **THEN** the resolver SHALL exclude those paths from the subset index

#### Scenario: Subset index in system prompt
- **WHEN** the related subset is non-empty
- **THEN** the system message SHALL include up to 8 ranked paths with titles as a「相关 wiki 子集」section without full page bodies

#### Scenario: User mention expands one hop
- **WHEN** a user `@` references a wiki page
- **THEN** the resolver SHALL include that page's 1-hop `links_to` neighbors as lower-ranked subset candidates

### Requirement: Builtin readonly chat wiki tools
The system SHALL provide an in-process readonly tool executor for session chat exposing at minimum `search`, `read`, and `references` with the same semantics as the MCP server tools.

#### Scenario: Search mode in chat
- **WHEN** the model invokes `search` with `mode=search` during session chat
- **THEN** the executor SHALL return FTS results scoped to the workspace wiki index

#### Scenario: Read full markdown in chat
- **WHEN** the model invokes `read` on a wiki markdown path
- **THEN** the executor SHALL return full document content subject to the existing read character budget

#### Scenario: Write tools rejected in chat
- **WHEN** the model or configuration exposes write tools (`create`, `edit`, `append`, `delete`)
- **THEN** session chat SHALL NOT register or execute them

### Requirement: Archive referenced pages export
The system SHALL export session reference rows into session archive markdown for downstream ingest planning.

#### Scenario: Frontmatter referenced_wiki_pages
- **WHEN** a session is archived
- **THEN** the archive markdown frontmatter SHALL include `referenced_wiki_pages` listing each tracked path, title, and source

#### Scenario: Body referenced section
- **WHEN** a session is archived with at least one reference row
- **THEN** the archive markdown body SHALL include a `## Referenced Wiki Pages` section summarizing the same list with wikilink-style paths

