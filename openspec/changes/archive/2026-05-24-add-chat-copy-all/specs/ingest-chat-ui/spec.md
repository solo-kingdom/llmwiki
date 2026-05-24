## ADDED Requirements

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
