# Baxter roadmap

## Completed

- Baxter application shell (dashboard, branding, tool-scoped navigation)
- Property Research Tool (existing PEM research workflow)
- Knowledge Base foundation (entries, revisions, sources registry, admin CRUD, approved retrieval)
- Knowledge-grounded OpenAI answering (`answerBaxterQuestion`)
- Baxter Dashboard chat assistant (Clippy-style launcher on `/` only)
- Shared conversation schema (`baxter_conversations` / messages / sources)
- Shared LLM provider abstraction (OpenAI now; Anthropic planned)
- Slack conversational bot (DMs, mentions, threads) reusing shared AI service
- Google Workspace connector (Docs/Sheets sync into Knowledge Base)
- Clickable source references (Google Doc/Sheet + knowledge entries)
- Connector health dashboard (`/admin/connectors`)

## Future (Prompt 5+)

- Buildertrend sync
- GoHighLevel sync
- Domo sync
- User feedback
- Full admin conversation analytics expansion
- Semantic retrieval / embeddings
- Proactive project monitoring
- RACI enforcement in answers

Baxter answers company-specific questions only from **approved** Acton knowledge, cites sources, and clearly says when information is missing.
