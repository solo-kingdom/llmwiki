## ADDED Requirements

### Requirement: Commit diff deep link from Chat
Timeline SHALL support opening a specific commit diff via URL query parameters so Chat archive review cards can link directly to diff view.

#### Scenario: Open diff via commit query
- **WHEN** user navigates to Timeline with `commit=<sha>` query parameter
- **AND** version control is enabled
- **THEN** Timeline SHALL open CommitDiffDialog for the specified commit SHA

#### Scenario: Invalid commit SHA
- **WHEN** user navigates with an unknown or invalid commit SHA
- **THEN** Timeline SHALL show an error toast or inline message
- **AND** SHALL display the normal commit list
