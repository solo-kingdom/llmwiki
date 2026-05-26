## ADDED Requirements

### Requirement: Direct ingest panel in Chat
The Ingest Chat UI SHALL provide a direct ingest workflow for batch file upload and multi-block text submission without requiring an LLM session conversation. This workflow SHALL be accessible from within Chat via a sheet or dialog panel (DirectIngestPanel), not as a separate workbench page.

#### Scenario: Open direct ingest from composer
- **WHEN** user clicks the direct ingest control in the chat composer toolbar
- **THEN** UI SHALL open DirectIngestPanel as a sheet or dialog overlay
- **AND** the panel SHALL NOT navigate away from the Chat view

#### Scenario: Direct ingest panel supports files and text blocks
- **WHEN** DirectIngestPanel is open
- **THEN** UI SHALL allow multi-file selection or drag-and-drop upload
- **AND** SHALL allow one or more text blocks with optional per-block titles
- **AND** SHALL allow optional batch title and source fields

#### Scenario: Direct ingest submits to pipeline APIs
- **WHEN** user submits direct ingest with valid files and/or non-empty text blocks
- **THEN** UI SHALL call existing `submitText` and/or `submitUpload` APIs (not session message APIs)
- **AND** SHALL display a submission summary with accepted and rejected job counts

#### Scenario: View jobs after direct ingest
- **WHEN** direct ingest submission completes with at least one accepted job
- **THEN** UI SHALL offer a control to navigate to the Jobs view

#### Scenario: Direct ingest empty state CTA
- **WHEN** the active session has no messages and the user is ready to start
- **THEN** the empty state SHALL show a secondary affordance to open DirectIngestPanel for raw material submission
- **AND** SHALL retain the primary hint encouraging conversational ingest

#### Scenario: Direct ingest distinct from session attachment
- **WHEN** user attaches files via the composer attachment control
- **THEN** UI SHALL continue to use the session attachment API
- **AND** SHALL NOT treat composer attachments as direct ingest pipeline submissions

## MODIFIED Requirements

### Requirement: Chat-first Ingest layout
The Ingest page SHALL present a chat interface as the primary interaction: scrollable message list, bottom composer, attachment affordances, and a primary **归档** action. Session management and model configuration actions SHALL be positioned close to the chat workflow: session switch/create entry and model selection entry SHALL be accessible from the chat interaction area without requiring a persistent wide left sidebar. Direct raw ingest (batch files and text blocks) SHALL be accessible from the composer toolbar via DirectIngestPanel without leaving Chat.

#### Scenario: Default chat view
- **WHEN** user opens the Ingest entry
- **THEN** page SHALL display message history (or empty state), input composer, and **归档** button as primary CTA

#### Scenario: Empty session prompt
- **WHEN** no messages exist in the active session
- **THEN** page SHALL show centered hint encouraging user to describe a topic or attach files
- **AND** SHALL offer a direct ingest affordance for users with ready-made materials

#### Scenario: Send message
- **WHEN** user types text and clicks **发送** or presses Enter (without Shift)
- **THEN** UI SHALL append user bubble, call session message API, and stream assistant reply into a new assistant bubble

#### Scenario: Session actions near chat workflow
- **WHEN** user needs to switch or create session while chatting
- **THEN** UI SHALL provide explicit session switch and session create actions in the chat interaction area

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
