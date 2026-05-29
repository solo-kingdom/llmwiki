---
name: llmwiki-query
description: Query and reorganize the LLM Wiki. Use when the user asks questions about the wiki's content, or wants to restructure, merge, or optimize the wiki.
license: MIT
metadata:
  author: llmwiki
  version: "1.0"
---

Query existing wiki knowledge or reorganize the wiki structure.

## When to Use

- User asks a question about topics in the wiki
- User says "what do we know about X?", "how are X and Y related?"
- User wants to restructure, merge, or reorganize pages
- User says "clean up the wiki", "merge duplicates", "reorganize"

## Two Modes

### QA Mode (Answer Questions)

1. **Search** for relevant pages:
   ```
   search(query="topic", mode="search")
   ```

2. **Read** the most relevant pages:
   ```
   read(path="wiki/entities/topic.md")
   ```

3. **Cross-reference** related pages to build a complete picture

4. **Synthesize** an answer grounded in wiki content
   - Cite specific pages: "According to [[Entity Name]]..."
   - If the wiki doesn't cover it fully, say so explicitly
   - Optionally suggest creating a new page for the gap

5. **Archive** valuable Q&A (if user wants):
   ```
   write(path="wiki/queries/topic-question.md", content="...")
   ```

### Organize Mode (Restructure)

1. **Get directory structure** and **audit health**:
   ```
   search(query="", mode="list")    → all pages
   search(query="", mode="lint")    → health check
   ```

2. **Identify issues**:
   - Duplicate or highly similar pages
   - Orphan pages (no incoming links)
   - Misplaced pages (wrong directory)
   - Missing cross-references
   - Dead links

3. **Plan reorganization**:
   - Which pages to merge
   - Which to move/rename
   - What new cross-references to add
   - What gaps to fill

4. **Execute changes** using MCP `write` / `delete`

5. **Verify** the restructured wiki passes lint checks

## Search Tips

- Use specific entity/concept names for best results
- The search uses SQLite FTS5 — supports phrase queries (`"exact phrase"`)
- If first search returns nothing, try alternative terms or broader queries
- For CJK content, the tokenizer handles word segmentation automatically

## Guardrails

- Answers MUST be grounded in existing wiki content — never fabricate facts
- If the wiki doesn't contain relevant info, say "The wiki does not yet cover this topic"
- When reorganizing, always read pages before merging — understand what you're combining
- Never delete `wiki/overview.md`, `wiki/index.md`, or `wiki/log.md`
- When merging pages, preserve all unique information from both sources
- Keep frontmatter consistent after reorganization
- Log major structural changes in the conversation for user awareness

## Done Criteria

### QA Mode
- [ ] Searched thoroughly for relevant pages
- [ ] Read and understood the relevant content
- [ ] Answer is grounded in wiki content with citations
- [ ] Acknowledged any gaps in wiki coverage

### Organize Mode
- [ ] Audited wiki health (lint check)
- [ ] Identified all structural issues
- [ ] Executed reorganization plan
- [ ] Verified no dead links or broken references after changes
- [ ] All pages have correct frontmatter after moves/merges
