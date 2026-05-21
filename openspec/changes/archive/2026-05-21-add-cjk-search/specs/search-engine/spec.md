## MODIFIED Requirements

### Requirement: Full-text search via SQLite FTS5
The system SHALL support full-text search over document chunks using SQLite FTS5 with BM25 ranking. For CJK (Chinese) content and queries, search SHALL use a tokenizer strategy that enables character-level matching (trigram or equivalent), not relying solely on LIKE fallback.

#### Scenario: Chinese keyword search
- **WHEN** client searches for a Chinese term present in indexed wiki content (e.g. "注意力")
- **THEN** results SHALL return matching chunks via FTS5 with BM25 ranking
- **AND** results SHALL NOT depend solely on LIKE fallback for primary ranking

#### Scenario: English search unchanged
- **WHEN** client searches for English terms (e.g. "transformer attention")
- **THEN** results SHALL continue to return relevant matches with ranking

#### Scenario: Reindex rebuilds CJK index
- **WHEN** user runs `llmwiki reindex` after CJK search upgrade
- **THEN** all document chunks SHALL be re-indexed into the updated FTS5 virtual table
