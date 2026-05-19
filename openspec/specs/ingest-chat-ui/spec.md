### Requirement: Chat-first Ingest layout
The Ingest page SHALL present a chat interface as the primary interaction: scrollable message list, bottom composer, attachment affordances, and a primary **归档** action. Session management and model configuration actions SHALL be positioned close to the chat workflow: session switch/create entry and model selection entry SHALL be accessible from the chat interaction area without requiring a persistent wide left sidebar.

#### Scenario: Default chat view
- **WHEN** user opens the Ingest entry
- **THEN** page SHALL display message history (or empty state), input composer, and **归档** button as primary CTA

#### Scenario: Empty session prompt
- **WHEN** no messages exist in the active session
- **THEN** page SHALL show centered hint encouraging user to describe a topic or attach files

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
The UI SHALL render user and assistant messages with distinct styling and support markdown in assistant content.

#### Scenario: User message bubble
- **WHEN** a user message is added
- **THEN** it SHALL appear right-aligned (or visually distinct) with plain text content

#### Scenario: Assistant streaming
- **WHEN** assistant response is streaming
- **THEN** UI SHALL incrementally render tokens in the assistant bubble until complete or error

#### Scenario: Assistant error state
- **WHEN** streaming fails
- **THEN** UI SHALL show error message with retry affordance on the failed assistant message

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
The UI SHALL provide an **归档** action that confirms intent, triggers archive API, and surfaces ingest job feedback.

#### Scenario: Archive confirmation
- **WHEN** user clicks **归档**
- **THEN** UI SHALL show confirmation (title editable, optional source note) before submitting

#### Scenario: Archive success feedback
- **WHEN** archive API returns job id
- **THEN** UI SHALL show success state with link or navigation to Jobs tab and job id

#### Scenario: Archive disabled when empty
- **WHEN** session has no user messages
- **THEN** **归档** button SHALL be disabled with tooltip explaining why

### Requirement: Navigation label Ingest
Global navigation SHALL label the default ingest entry **Ingest** (not Ingest Hub).

#### Scenario: Entry label
- **WHEN** user views global header navigation
- **THEN** the ingest entry label SHALL read `Ingest`

#### Scenario: Dependency warning on Ingest entry
- **WHEN** runtime dependencies are missing
- **THEN** warning icon SHALL appear adjacent to the Ingest entry label (same behavior as prior Ingest Hub warning)
