## MODIFIED Requirements

### Requirement: Chat-first Ingest layout
The Ingest page SHALL present a chat interface as the primary interaction: scrollable message list, bottom composer, attachment affordances, and a primary **归档** action. Session management and model configuration actions SHALL be positioned close to the chat workflow: session switch/create entry and model selection entry SHALL be accessible from the chat interaction area without requiring a persistent wide left sidebar. Ready-made plain text materials SHALL be addable via the context append dialog without leaving Chat. The archive confirmation panel SHALL offer a deep organize option when the session is in organize mode.

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

#### Scenario: Archive panel deep organize option
- **WHEN** user clicks **归档** and the active session mode is `organize`
- **THEN** the archive confirmation panel SHALL display a checkbox labeled with deep organize description
- **AND** the checkbox SHALL default to unchecked

#### Scenario: Archive panel hides deep organize for non-organize modes
- **WHEN** user clicks **归档** and the active session mode is `ingest` or `qa`
- **THEN** the archive confirmation panel SHALL NOT display the deep organize checkbox

#### Scenario: Deep organize flag sent to API
- **WHEN** user confirms archive with deep organize checkbox checked
- **THEN** UI SHALL include `deep_organize: true` in the archive request body

#### Scenario: Deep organize flag omitted when unchecked
- **WHEN** user confirms archive with deep organize checkbox unchecked
- **THEN** UI SHALL include `deep_organize: false` or omit the field in the archive request body
