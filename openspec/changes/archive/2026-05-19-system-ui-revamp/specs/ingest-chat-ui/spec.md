## MODIFIED Requirements

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
