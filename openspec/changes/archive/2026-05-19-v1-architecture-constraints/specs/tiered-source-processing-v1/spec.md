## ADDED Requirements

### Requirement: Tiered source processing capability
First-release source processing SHALL support PDF/Office via tiered capability levels with clear runtime behavior.

#### Scenario: Tier selection on processing
- **WHEN** a PDF or Office file is submitted for ingest
- **THEN** the system selects the highest available processing tier based on runtime capabilities and configured dependencies

### Requirement: Optional system dependency support
The processing pipeline SHALL support optional system dependencies (e.g., document conversion/extraction tools) without making them mandatory for service startup.

#### Scenario: Dependency unavailable fallback
- **WHEN** required optional dependency for high-tier extraction is unavailable
- **THEN** the system degrades to a lower tier and returns structured reason metadata

### Requirement: Degradation observability
Degraded processing SHALL be visible in API/UI/log outputs with actionable reason and next-step guidance.

#### Scenario: User-visible degradation explanation
- **WHEN** Office processing falls back due to missing converter dependency
- **THEN** response payload and logs include fallback tier, missing dependency, and remediation hint

### Requirement: Forward enhancement declaration
The capability SHALL include documented extension points for future higher-fidelity parsing/OCR enhancements.

#### Scenario: Roadmap visibility
- **WHEN** operators review source processing documentation
- **THEN** they can identify planned enhancement path beyond first-release baseline tiers
