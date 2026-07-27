# Baxter roadmap

## Completed

- Baxter application shell (dashboard, branding, tool-scoped navigation)
- Property Research Tool (existing PEM research workflow)
- Knowledge Base foundation (entries, revisions, sources registry, admin CRUD, approved retrieval)
- Knowledge-grounded OpenAI answering (`answerBaxterQuestion`)
- Baxter Dashboard chat assistant (Clippy-style launcher on `/` only)
- Shared conversation schema (`baxter_conversations` / messages / sources)
- Shared LLM provider abstraction (OpenAI + Anthropic with optional fallback)
- Hybrid retrieval (structured + lexical + semantic embeddings) — Prompt 2
- Multimodal indexing (images, PDF pages, Slides/PPTX) — Prompt 2
- Evaluation foundation (`baxter_eval_cases`) — Prompt 2
- Google Workspace connector (Docs/Sheets/Slides/images sync into Knowledge Base)
- Clickable source references (Google Doc/Sheet + knowledge entries)
- Connector health dashboard (`/admin/connectors`)
- Useful web assistant behavior (identity, classification, general + grounded answers, continuity)
- Admin Baxter diagnostics (`/admin/baxter/diagnostics`)
- **Prompt 5B — Slack production readiness**
  - Shared `answerBaxterQuestion()` for Slack DMs and `@Baxter` mentions
  - Durable event deduplication (`slack_event_receipts`, migration 009)
  - Async `slack_baxter_reply` jobs with `after()` + Vercel cron
  - Channel/user allowlists and mention-required channel follow-ups
  - Slack mrkdwn formatting with validated source links
  - Health model (`disabled` / `misconfigured` / `ready` / `warning` / `offline`)
  - Admin Slack diagnostics (`/admin/slack`, conversation detail)
  - Comprehensive setup guide (`docs/slack-setup.md`) and manifest (`docs/slack-app-manifest.yaml`)
  - Existing `/property` slash command preserved
- **Prompt 5C — Final launch readiness**
  - OpenAI error classification (quota/billing vs temporary rate limits) with selective retries
  - Optional `BAXTER_OPENAI_FALLBACK_MODEL` for model-specific limits
  - Web chat idempotency (duplicate request prevention)
  - Web chat thumbs feedback (`baxter_message_feedback`, migration 010)
  - Admin feedback review (`/admin/baxter/feedback`)
  - Launch readiness dashboard (`/admin/baxter/launch-readiness`)
  - Google scheduled sync (`GOOGLE_SYNC_ENABLED`, `GOOGLE_SYNC_INTERVAL_MINUTES`)
  - Google admin diagnostics (dry-run sync, Shared Drive guidance, `BAXTER_GOOGLE_*` codes)
  - Production checklist (`docs/production-checklist.md`)
  - Employee guide (`docs/baxter-employee-guide.md`)
  - `/property` report ownership: optional `SLACK_REPORT_USER_ID` or first admin (no fake Supabase users for Slack Q&A)
- **Prompt 6 — Google Drive Knowledge Manager**
  - Explicit file/folder selection (recursive + future-file inclusion + exclusions)
  - Drive browser, preview, sync dashboard, setup checklist
  - Migration 011 (`google_source_selections`, `google_synced_files`, `google_sync_runs`)
  - Admin manual sync `POST /api/admin/connectors/google/sync` (no cron secret)
  - Cron auth standardized on `CRON_SECRET` Bearer (legacy `INTERNAL_CRON_SECRET`)
  - Hobby-safe daily Vercel cron; due logic via `GOOGLE_SYNC_INTERVAL_MINUTES`
  - Structured Sheets export (tabs/headers/rows)
  - Guide: `docs/google-drive-knowledge-manager.md`
- **Knowledge Management Rework — Prompt 1 of 3**
  - Simplified manual entry (title + content)
  - Fixed Knowledge delete (`baxter_message_sources` FK + actionable errors)
  - Document uploads (md/txt/pdf/docx/csv/xlsx) with preview + duplicates
  - Migration 012 (`knowledge_uploads`, private `knowledge-uploads` bucket)
  - Knowledge landing page + admin navigation (Upload, Google Drive)
  - Guide: `docs/knowledge-imports.md`

## Current

- Initial Acton employee Slack pilot (Jackson, Milan, Maxx, James — see `docs/slack-setup.md` section 21)
- Baxter Intelligence Prompt 1: structured knowledge units + spreadsheet exact lookup (migration 016)
- Baxter Intelligence Prompt 2: hybrid retrieval, embeddings, multimodal, Anthropic fallback, eval foundation (migration 017)
- Baxter Intelligence Prompt 3: conversation context policy, `/clear`, temporal sales aggregation, eval suite, multimodal viewers (migration 018) — done
- Admin UX: Integrations nav (`/admin/connectors`), Uploads removed from top nav, Slack Activity by user/channel with display-name cache (migration 019)
- Baxter runtime governance v1.1: Acton culture/brand/value-prop distillation, evidence-as-data, change control, `/admin/baxter/governance`
- GoHighLevel Prompt 1: secure connector, PIT default, resource clients, migration **020**
- GoHighLevel Prompt 2: capability health, live CRM evidence in Baxter, confirmed contact/opportunity writes, migration **021** — done
- GoHighLevel Prompt 3: v3 API contracts, opportunity search fix, coherent health, entity graph, read-only insights, `/clear` cancels pending actions — done
- GoHighLevel CRM UX: human-readable admin CRM (Contacts/Opportunities/Conversations/Actions), contact `pageLimit` contract, reference cache auto-warm, ID hydration, opportunity ranking for multi-opp contacts — done

## Future

- GoHighLevel: message send / calendar book / autonomous monitoring (future initiative)
- Buildertrend sync
- Domo sync
- Full admin conversation analytics expansion
- RACI enforcement in answers

Baxter answers company-specific questions from **approved** Acton knowledge when available, cites sources, uses clearly labeled general guidance when safe, and explains itself even when the Knowledge Base is sparse.
