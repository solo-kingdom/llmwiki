## MODIFIED Requirements

### Requirement: Workspace management UI
The system SHALL provide a management workbench for private operational tasks and a distinct Wiki reader for browsing and presenting Wiki pages. The management workbench SHALL focus on Ingest, Jobs, and Settings. The Wiki reader SHALL be reachable from the workbench but SHALL NOT be treated as a peer management tab inside the reader experience.

#### Scenario: Management workbench default
- **WHEN** the user opens the management workbench entry point
- **THEN** the default management view SHALL remain the ingest interface

#### Scenario: Management navigation excludes reader tab semantics
- **WHEN** the user views the management workbench navigation
- **THEN** Ingest, Jobs, and Settings SHALL be presented as management destinations
- **AND** Wiki SHALL be presented as a reader destination or link rather than a same-level management tab

#### Scenario: Reader and workbench use separate shells
- **WHEN** the user navigates between the workbench and Wiki reader
- **THEN** the system SHALL switch between workbench layout and reader layout without exposing management controls inside the reader article surface

#### Scenario: Existing management behavior preserved
- **WHEN** the user uses Ingest, Jobs, or Settings after this change
- **THEN** existing management workflows SHALL remain available and protected by existing management access rules
