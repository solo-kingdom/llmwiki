## ADDED Requirements

### Requirement: Wiki page mention in composer
The Ingest Chat composer SHALL support `@` mentions of wiki pages with autocomplete and visual chips.

#### Scenario: Open mention picker
- **WHEN** user types `@` in the chat composer
- **THEN** UI SHALL show a dropdown of wiki pages searchable by title and path via the document search API

#### Scenario: Select mention chip
- **WHEN** user selects a page from the mention dropdown
- **THEN** UI SHALL display a removable chip with page title or path
- **AND** SHALL include the selection in the next send request as `wiki_refs`

#### Scenario: Mention limit feedback
- **WHEN** user attempts to attach more than 5 wiki page chips
- **THEN** UI SHALL prevent additional selections and show a brief limit hint

### Requirement: Wiki reference display in messages
The UI SHALL surface wiki context used in a turn.

#### Scenario: User message shows refs
- **WHEN** a user message was sent with `wiki_refs`
- **THEN** the user bubble SHALL show a compact list of referenced wiki paths or titles below the message text

#### Scenario: Tool activity indicator
- **WHEN** SSE emits `tool_start` or `tool_done` during assistant streaming
- **THEN** UI SHALL show transient tool status (e.g. searching/reading) near the active assistant bubble

#### Scenario: Assistant cites read pages
- **WHEN** assistant streaming completes after tool reads
- **THEN** UI MAY show a collapsible「查阅的 wiki 页面」list derived from `tool_done` events for that turn
