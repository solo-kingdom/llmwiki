## ADDED Requirements

### Requirement: Reader and workbench width distinction
The Wiki reader SHALL retain a reader-first full-screen layout that is intentionally distinct from the management workbench content column. The reader header MAY share the same card-style visual treatment as the workbench header, but the reader SHALL NOT be constrained to the workbench `max-w-5xl` content column.

#### Scenario: Reader uses available screen width
- **WHEN** user opens the Wiki reader on a desktop-sized viewport
- **THEN** the reader layout SHALL be allowed to use the available viewport width for document navigation, document content, and outline panels
- **AND** the reader SHALL NOT force its header or main content into the management workbench centered content column

#### Scenario: Reader keeps visual relationship with workbench
- **WHEN** user compares the Wiki reader header and the management workbench header
- **THEN** both headers SHALL use compatible card-style visual treatment
- **AND** the difference in width strategy SHALL reflect their different product purposes rather than a mismatch of component styling

#### Scenario: Workbench link remains available from reader
- **WHEN** user views the Wiki reader
- **THEN** the reader header SHALL continue to provide a clear affordance for returning to the management workbench
