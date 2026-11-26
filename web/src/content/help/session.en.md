## Session Modes

The Ingest page offers three session modes that control AI behavior and available tools:

| Mode | Purpose | Tools | Characteristics |
|------|---------|-------|-----------------|
| **Chat** (default) | Explore materials, digest content | search, read, web_fetch | High conversational freedom, ideal for daily ingestion |
| **QA** | Query existing wiki knowledge | search, read, web_fetch, references | Focused knowledge retrieval; answers can be archived as query pages |
| **Organize** | Restructure and optimize wiki | All tools (incl. audit, structure, gaps, similar) | AI calls diagnostic tools in first round; most rounds (12) |

**Ingest flow**:

1. Select a mode and start chatting (or add context / upload attachments)
2. Interact with AI over multiple turns to explore and understand materials
3. When satisfied, click **Archive** → AI generates a plan (listing pages to create/update)
4. Preview the plan in the review card → confirm or cancel
5. System writes files → monitor status on **Jobs**
6. Read results on **Wiki**

**Merge protection**: writing to an existing page merges by default (locked fields preserved, arrays unioned, body intelligently merged by LLM) — your existing content is never overwritten.
