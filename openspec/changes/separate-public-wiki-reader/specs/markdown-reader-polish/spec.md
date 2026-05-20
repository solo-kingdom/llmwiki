## ADDED Requirements

### Requirement: mdserve-inspired reader styling
The Wiki reader SHALL adopt a polished reader-first visual style inspired by the local `mdserve` reference project while preserving LLMWiki's existing technology stack and design tokens.

#### Scenario: Reader header style
- **WHEN** the user views the Wiki reader
- **THEN** the header SHALL use a compact rounded card treatment with subtle border, translucent card background, backdrop blur, and light shadow

#### Scenario: Document card style
- **WHEN** a document is selected
- **THEN** the document SHALL render inside a rounded card with subtle border and shadow
- **AND** document metadata SHALL appear in a visually distinct information bar

#### Scenario: Point color metadata bar
- **WHEN** the selected document has metadata such as path, file type, page count, update time, or tags
- **THEN** the reader SHALL present that metadata using a soft accent treatment inspired by `mdserve`'s point color pattern

### Requirement: Improved Markdown readability
The Wiki reader SHALL improve Markdown readability for common document elements.

#### Scenario: Inline code
- **WHEN** Markdown contains inline code
- **THEN** the reader SHALL display it with a subtle background, rounded corners, monospace font, and no extra generated backtick characters

#### Scenario: Code blocks
- **WHEN** Markdown contains fenced code blocks
- **THEN** the reader SHALL display them in a readable block with consistent spacing, rounded corners, and horizontal overflow handling

#### Scenario: Tables and links
- **WHEN** Markdown contains GFM tables or links
- **THEN** the reader SHALL render them with styling that remains legible in the document card and preserves existing navigation behavior for Wiki links

### Requirement: Reader scroll and panel affordances
The Wiki reader SHALL provide smooth reading and navigation affordances comparable to a dedicated Markdown reader.

#### Scenario: Article scrolling
- **WHEN** the user scrolls the article
- **THEN** the scroll container SHALL preserve stable layout and SHOULD avoid visually noisy persistent scrollbars where supported

#### Scenario: Collapsible side panels
- **WHEN** a desktop user collapses the file tree or outline panel
- **THEN** the central document area SHALL expand while preserving an affordance to reopen the collapsed panel

#### Scenario: Heading outline navigation
- **WHEN** the user clicks an outline entry
- **THEN** the article SHALL scroll smoothly to the corresponding heading
