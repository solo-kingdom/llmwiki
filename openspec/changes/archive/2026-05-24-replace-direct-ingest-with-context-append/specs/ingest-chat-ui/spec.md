## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Direct ingest panel in Chat
**Reason**: Direct ingest bypassed session archive and Review gate; replaced by context append + Chat archive unified pipeline.
**Migration**: Use the add-context dialog for pasted plain text; use composer attachment for plain text files; external integrations may continue using `submitText` / `submitUpload` APIs.
