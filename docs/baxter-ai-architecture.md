# Baxter AI architecture

## Purpose

Baxter is Acton ADU’s internal AI assistant. It combines:

1. Built-in identity (`identity.ts`)
2. Approved Knowledge Base retrieval (manual + Google-synced)
3. Conversation history
4. OpenAI general assistance

Web chat (`POST /api/baxter/chat`) and Slack Events (`POST /api/slack/events`) both call `answerBaxterQuestion()` with `channel: "web"` or `channel: "slack"`.

## Query classification

Deterministic classes in `classify.ts`:

- `baxter_identity`
- `acton_company_specific` / `acton_process_specific`
- `general_knowledge`
- `conversational` / `clarification`
- `unsafe_or_disallowed`

Classification controls whether Baxter can answer without KB hits, must ground in Acton sources, or may use general knowledge.

## Answer modes

- `identity` — Baxter information
- `grounded` — Approved Acton knowledge (+ Sources)
- `general` — General guidance
- `mixed` — Official Acton answer unavailable; labeled general help
- `clarification`

## Retrieval

`searchApprovedKnowledge()` scores approved internal entries with normalized tokens, stop-word filtering, light stemming, and small synonym expansion. No embeddings yet.

## OpenAI

HTTP chat/completions with JSON object responses. Lenient parsing keeps a usable answer when optional metadata fails. Errors use codes such as `BAXTER_OPENAI_KEY_MISSING`.

## Diagnostics

`/admin/baxter/diagnostics` — configuration Yes/No, KB counts, recent error codes, OpenAI/KB/pipeline tests, idempotent Baxter Overview bootstrap.

## Slack (Prompt 5B)

Slack uses the same classification, retrieval, and OpenAI path as web chat. Slack-specific layers:

- **Events API** — signature verification, team/channel/user allowlists, durable dedupe via `slack_event_receipts`
- **Async processing** — `slack_baxter_reply` jobs processed by `after()` and Vercel cron (`/api/internal/process-jobs`, every 2 minutes)
- **Conversation mapping** — `external_thread_id` = `team:channel:user` (DM) or `team:channel:thread_ts` (channel thread); `user_id` stays null
- **Formatting** — Slack mrkdwn with escaped markup, validated source links, message splitting
- **Access** — empty `SLACK_ALLOWED_CHANNEL_IDS` disables channel mentions; DMs enabled by default
- **Admin** — `/admin/slack` health (`disabled` / `misconfigured` / `ready` / `warning` / `offline`)

Setup: `docs/slack-setup.md` · Details: `docs/slack-bot.md`

## Safety

- Never invent official Acton policy
- Never invent source URLs
- Never expose secrets
- Chat only on `/` for the launcher
- Slack tokens and signing secrets server-side only
