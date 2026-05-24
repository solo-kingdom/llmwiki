# ingest-chat-ui Specification

## Purpose
Define the Ingest Chat web UI: composer, message rendering, attachments, archive flow, and wiki-aware interaction affordances.
## Requirements
### Requirement: Chat-first Ingest layout
The Ingest page SHALL present a chat interface as the primary interaction: scrollable message list, bottom composer, attachment affordances, and a primary **归档** action. Session management and model configuration actions SHALL be positioned close to the chat workflow: session switch/create entry and model selection entry SHALL be accessible from the chat interaction area without requiring a persistent wide left sidebar. Ready-made plain text materials SHALL be addable via the context append dialog without leaving Chat.

#### Scenario: Default chat view
- **WHEN** user opens the Ingest entry
- **THEN** page SHALL display message history (or empty state), input composer, and **归档** button as primary CTA

#### Scenario: Empty session prompt
- **WHEN** no messages exist in the active session
- **THEN** page SHALL show centered hint encouraging user to describe a topic or attach files
- **AND** SHALL offer a context-append affordance for users with ready-made plain text materials

#### Scenario: Send message
- **WHEN** user types text and clicks **发送** or presses Enter (without Shift)
- **THEN** UI SHALL append user bubble, call session message API, and stream assistant reply into a new assistant bubble

#### Scenario: Session actions near chat workflow
- **WHEN** user needs to switch or create session while chatting
- **THEN** UI SHALL provide explicit session switch and session create actions in the chat interaction area

### Requirement: Provider instance model selector
The UI SHALL provide model selection through a button-triggered modal workflow near the composer action area. The modal SHALL allow selecting provider instance first and model second, where model choices come from the selected instance's catalog provider. After confirmation, the active session SHALL persist the selected instance/model pair.

#### Scenario: Open selector modal from composer area
- **WHEN** user clicks the model selector entry near the send button
- **THEN** UI SHALL open a model selection modal

#### Scenario: Instance then model selection
- **WHEN** user selects an instance in the modal
- **THEN** the model list SHALL load from the instance's catalog provider (via `GET /api/v1/providers/{catalog_id}/models`)

#### Scenario: Persist selected pair to session
- **WHEN** user confirms the instance/model pair in the modal
- **THEN** UI SHALL update the active session model configuration via existing session update API

#### Scenario: Display selected provider and model near composer
- **WHEN** session has an active provider/model pair
- **THEN** UI SHALL display the selected provider and model as muted/gray status indicators near the composer

#### Scenario: No instances configured
- **WHEN** no provider instances have been added
- **THEN** model selection entry SHALL show guidance directing user to Settings to add a Provider

### Requirement: Message rendering
The UI SHALL render user and assistant messages with distinct styling and support markdown in assistant content. Assistant markdown SHALL use the shared wiki-prose styling system with a compact chat variant inside message bubbles. Streaming assistant content SHALL be rendered as markdown incrementally (not as plain pre-wrapped text).

#### Scenario: User message bubble
- **WHEN** a user message is added
- **THEN** it SHALL appear right-aligned (or visually distinct) with plain text content

#### Scenario: Assistant streaming
- **WHEN** assistant response is streaming
- **THEN** UI SHALL incrementally render tokens in the assistant bubble as formatted markdown until complete or error
- **AND** headings, lists, code blocks, and tables SHALL be visually distinguishable during streaming

#### Scenario: Assistant completed markdown
- **WHEN** assistant streaming completes successfully
- **THEN** the assistant bubble SHALL render markdown using the compact chat prose styles
- **AND** code blocks SHALL support syntax highlighting consistent with the Wiki reader

#### Scenario: Assistant error state
- **WHEN** streaming fails or is incomplete
- **THEN** UI SHALL show error message with retry affordance on the failed assistant message
- **AND** retry SHALL reuse the same assistant message row and SHALL NOT create duplicate user messages

### Requirement: Stop streaming reply
While the assistant is streaming, the composer SHALL allow the user to cancel the in-flight request.

#### Scenario: Stop button during stream
- **WHEN** a session message stream is in progress
- **THEN** the send control SHALL become a Stop button
- **AND** clicking Stop SHALL abort the client fetch via `AbortController`

#### Scenario: Partial content preserved after stop
- **WHEN** user stops a stream
- **THEN** the assistant message SHALL remain visible with `stream_status=incomplete`
- **AND** UI SHALL offer retry on that message row

### Requirement: Message action bar
User and assistant message bubbles SHALL expose a hover action bar below the bubble with copy and exclude-from-archive controls.

#### Scenario: Action bar on hover
- **WHEN** user hovers a user or assistant message
- **THEN** UI SHALL show an action bar below the bubble with copy and exclude-from-archive affordances

#### Scenario: Toggle exclude from archive
- **WHEN** user toggles exclude-from-archive on a message
- **THEN** UI SHALL persist the flag via `PATCH /api/v1/ingest/sessions/{id}/messages/{messageId}`
- **AND** SHALL reflect excluded state visually on that message

### Requirement: Attachment interaction in chat
The UI SHALL allow attaching images and files from the composer and display attachment summaries as assistant messages.

#### Scenario: Attach via button
- **WHEN** user clicks attachment control and selects files
- **THEN** UI SHALL upload via session attachment API and show upload progress

#### Scenario: Attachment understanding message
- **WHEN** server returns attachment summary message
- **THEN** UI SHALL render it as an assistant message referencing the attachment name

#### Scenario: Drag and drop on composer
- **WHEN** user drops files onto the composer area
- **THEN** UI SHALL upload files using the same attachment flow

### Requirement: Archive flow in UI
The UI SHALL provide an **归档** action that confirms intent, triggers archive API, and surfaces archive review feedback inline in Chat via ArchiveReviewCard.

#### Scenario: Archive confirmation
- **WHEN** user clicks **归档**
- **THEN** UI SHALL show confirmation (title editable, optional source note) before submitting

#### Scenario: Archive success feedback
- **WHEN** archive API returns `review_id`
- **THEN** UI SHALL render ArchiveReviewCard in Chat with the returned review
- **AND** SHALL NOT navigate to or link to a separate Review page as the primary path

#### Scenario: Archive disabled when empty
- **WHEN** session has no persisted user messages (including when only optimistic `temp-*` client rows exist)
- **THEN** **归档** button SHALL be disabled with tooltip explaining why

#### Scenario: Archive disabled when session archived
- **WHEN** the active ingest session `status` is `archived`
- **THEN** **归档** button SHALL be disabled with tooltip indicating the session is already archived

#### Scenario: Archive submit deduplication
- **WHEN** user confirms archive while a submit is already in flight
- **THEN** the UI SHALL invoke the archive API at most once until the in-flight request completes

### Requirement: Navigation label Ingest
Global navigation SHALL label the default ingest entry **Ingest** (not Ingest Hub). The workbench SHALL NOT expose a separate Raw Ingest navigation entry.

#### Scenario: Entry label
- **WHEN** user views global header navigation
- **THEN** the primary ingest entry label SHALL read `Ingest`

#### Scenario: Dependency warning on Ingest entry
- **WHEN** runtime dependencies are missing
- **THEN** warning icon SHALL appear adjacent to the Ingest entry label (same behavior as prior Ingest Hub warning)

#### Scenario: No separate raw ingest nav entry
- **WHEN** user views global header navigation
- **THEN** a second Raw Ingest tab SHALL NOT be present

### Requirement: Wiki page mention in composer
The Ingest Chat composer SHALL support `@` mentions of wiki pages with in-text fuzzy search and visual chips. The composer SHALL NOT use a separate standalone wiki search input above the textarea.

#### Scenario: Open mention picker from textarea
- **WHEN** user types `@` in the chat composer textarea
- **THEN** UI SHALL open a popup panel anchored to the composer
- **AND** SHALL filter loaded wiki documents client-side with fuzzy matching on title and path

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

### Requirement: Copy all session messages
The Ingest Chat message panel SHALL provide a **copy all** action that copies the full visible conversation of the active session to the clipboard as plain text.

#### Scenario: Copy all button in message panel header
- **WHEN** the active session has at least one copyable message
- **THEN** UI SHALL show a copy-all control in the message panel header (above the scrollable message list)
- **AND** the control SHALL be right-aligned within the header

#### Scenario: Copy all hidden when empty
- **WHEN** the active session has no copyable messages
- **THEN** the copy-all control SHALL NOT be shown

#### Scenario: Copy all formats conversation
- **WHEN** user activates copy-all
- **THEN** UI SHALL write plain text to the clipboard containing user and assistant messages in chronological order
- **AND** each block SHALL be prefixed with a localized role label (e.g. User / Assistant)
- **AND** blocks SHALL be separated by a blank line
- **AND** user messages with `wiki_refs` SHALL append referenced wiki titles or paths after the message text
- **AND** attachment summary messages SHALL be included with a localized attachment label prefix

#### Scenario: Copy all skips non-conversational content
- **WHEN** copy-all is activated
- **THEN** UI SHALL skip `system` role messages
- **AND** SHALL NOT include tool status, tool reads, or debug metadata in the copied text

#### Scenario: Copy all includes partial and failed assistant messages
- **WHEN** an assistant message is streaming, incomplete, or failed
- **THEN** copy-all SHALL include its current `content` if present
- **AND** if content is empty but an error message exists, SHALL include the error message instead

#### Scenario: Copy all feedback
- **WHEN** copy-all succeeds
- **THEN** UI SHALL show brief copied feedback on the copy-all control (consistent with single-message copy behavior)

### Requirement: Context append dialog in Chat
The Ingest Chat UI SHALL provide a context-only text input workflow for adding ready-made plain text to the active session without triggering an LLM reply. This workflow SHALL be accessible via a dialog opened from the composer toolbar, positioned immediately to the left of the attachment control.

#### Scenario: Open context dialog from composer
- **WHEN** user clicks the add-context control in the chat composer toolbar
- **THEN** UI SHALL open a dialog overlay for multi-block plain text input
- **AND** the dialog SHALL NOT navigate away from the Chat view

#### Scenario: Context dialog supports multi-block text
- **WHEN** the context input dialog is open
- **THEN** UI SHALL allow one or more text blocks with optional per-block titles
- **AND** SHALL require at least one non-empty text block before submit is enabled

#### Scenario: Context append does not trigger LLM
- **WHEN** user submits valid text blocks from the context dialog
- **THEN** UI SHALL call the non-streaming session message append API
- **AND** SHALL NOT start an assistant streaming reply
- **AND** SHALL append the persisted user message to the message list

#### Scenario: Context append enables archive
- **WHEN** context append succeeds and the session had no prior persisted user messages
- **THEN** the **归档** control SHALL become enabled (subject to other existing archive guards)

#### Scenario: Context append without provider
- **WHEN** no provider instance or model is configured for the session
- **THEN** the add-context control and dialog submit SHALL remain usable
- **AND** send and archive controls SHALL continue to follow existing provider readiness rules

#### Scenario: Context empty state CTA
- **WHEN** the active session has no messages and the user is ready to start
- **THEN** the empty state SHALL show a secondary affordance to open the context input dialog for ready-made plain text
- **AND** SHALL retain the primary hint encouraging conversational ingest

#### Scenario: Plain text files use attachment
- **WHEN** user has a plain text file (e.g. `.txt` or `.md`) to add as material
- **THEN** UI SHALL direct them to the composer attachment control (not the context dialog file upload)
- **AND** attachment behavior SHALL remain the existing session attachment API with LLM summary

