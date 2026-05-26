## MODIFIED Requirements

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
