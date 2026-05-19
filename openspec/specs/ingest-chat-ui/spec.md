### Requirement: Chat-first Ingest layout
The Ingest page SHALL present a chat interface as the primary interaction: scrollable message list, bottom composer, attachment affordances, and a primary **归档** action. The model selector SHALL use provider instances (not catalog providers) as the data source.

#### Scenario: Default chat view
- **WHEN** user opens the Ingest tab
- **THEN** page SHALL display message history (or empty state), input composer, and **归档** button as primary CTA

#### Scenario: Empty session prompt
- **WHEN** no messages exist in the active session
- **THEN** page SHALL show centered hint encouraging user to describe a topic or attach files

#### Scenario: Send message
- **WHEN** user types text and clicks **发送** or presses Enter (without Shift)
- **THEN** UI SHALL append user bubble, call session message API, and stream assistant reply into a new assistant bubble

### Requirement: Provider instance model selector
The UI SHALL provide a two-dropdown model selector: the first dropdown lists user-added provider instances, the second dropdown lists models available for the selected instance's catalog provider.

#### Scenario: Instance dropdown
- **WHEN** the chat header renders
- **THEN** the first dropdown SHALL show all user-added provider instances by name, with no ⚠ warnings (only configured instances appear)

#### Scenario: Model dropdown
- **WHEN** user selects an instance
- **THEN** the second dropdown SHALL load models from the instance's catalog provider (via `GET /api/v1/providers/{catalog_id}/models`)

#### Scenario: No instances configured
- **WHEN** no provider instances have been added
- **THEN** both dropdowns SHALL be disabled and the UI SHALL display a message directing user to Settings to add a Provider

#### Scenario: Model invalidation after instance type change
- **WHEN** user switches to a session whose instance had its catalog_id changed and the stored model no longer exists in the new provider's model list
- **THEN** the model dropdown SHALL clear its selection and prompt the user to select a new model

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
Global navigation SHALL label the default ingest tab **Ingest** (not Ingest Hub).

#### Scenario: Tab label
- **WHEN** user views global header tabs
- **THEN** the ingest tab label SHALL read `Ingest`

#### Scenario: Dependency warning on Ingest tab
- **WHEN** runtime dependencies are missing
- **THEN** warning icon SHALL appear adjacent to the Ingest tab label (same behavior as prior Ingest Hub warning)
