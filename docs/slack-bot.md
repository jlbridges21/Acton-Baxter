# Baxter Slack bot

## Purpose

Baxter answers Acton employees in Slack using the **same** `answerBaxterQuestion()` service as the web chat. Slack-specific code handles events, access control, formatting, and API calls only — no duplicated AI logic.

Property Research remains a separate flow via the `/property` slash command.

Setup guide: `docs/slack-setup.md`

---

## Shared AI backend

Both channels call the same pipeline:

```
POST /api/baxter/chat          (web)
POST /api/slack/events         (Slack Events API)
        ↓
answerBaxterQuestion({ channel: "slack", ... })
        ↓
Knowledge retrieval · classification · OpenAI · conversation history
        ↓
Formatted reply (web JSON or Slack mrkdwn)
```

Slack passes:

- `channel: "slack"`
- `userId: null` — no fake Supabase user
- `externalUserId` — Slack user ID (`U...`)
- `externalThreadId` — stable conversation key (see below)
- `userName` — resolved Slack display name when available (`users:read` / `users.profile:read`), else `Slack user U…`

---

## Event flow

```
Slack event
  → verify signature (SLACK_SIGNING_SECRET)
  → validate team (SLACK_ALLOWED_TEAM_IDS)
  → claim event (slack_event_receipts — durable dedupe)
  → enqueue slack_baxter_reply job
  → HTTP 200 immediately
  → after() + cron process job
  → answerBaxterQuestion()
  → chat.postMessage (thread or DM)
  → update receipt status
```

### Durable receipts

Migration `009_slack_production.sql` creates `slack_event_receipts`:

| Status       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `received`   | Event claimed, job enqueued                                |
| `processing` | Job in progress                                            |
| `completed`  | Reply posted successfully                                  |
| `failed`     | Error recorded with `BAXTER_SLACK_*` code                  |
| `ignored`    | Bot message, disallowed channel, unsupported subtype, etc. |

Slack retries receive HTTP 200 with `duplicate: true` — no duplicate replies.

### Async jobs

Job type: `slack_baxter_reply` on the existing `report_jobs` queue.

- **Immediate:** Next.js `after()` in `/api/slack/events` claims and processes the job
- **Backup:** Vercel Cron on `/api/internal/process-jobs` (see `vercel.json`)

---

## Conversation mapping

| Context                 | `external_thread_id` format    | Behavior                      |
| ----------------------- | ------------------------------ | ----------------------------- |
| DM                      | `team_id:channel_id:user_id`   | One conversation per user DM  |
| Channel thread          | `team_id:channel_id:thread_ts` | One conversation per thread   |
| New top-level `@Baxter` | New `thread_ts`                | Starts a **new** conversation |

Follow-ups in the **same DM** reuse the conversation automatically.

Send plain-text **`/clear`** in a DM or thread to close that Baxter conversation and start fresh (no Slack slash-command registration required). Historical messages remain for admin diagnostics.

In **channels**, follow-ups require another `@Baxter` mention (mention-required default) because the app does not subscribe to broad channel history events.

Conversations are stored with `user_id = null` and `external_user_id` set to the Slack user ID.

---

## Access control

| Setting                         | Behavior                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `SLACK_ALLOWED_TEAM_IDS`        | Required when enabled — rejects other workspaces                                       |
| `SLACK_ALLOWED_CHANNEL_IDS`     | **Empty = channel mentions disabled** (safe default). Non-empty = only those channels. |
| `SLACK_ALLOWED_USER_IDS`        | Empty = all humans in allowed workspace. Non-empty = pilot allowlist.                  |
| `SLACK_ENABLE_DMS`              | Toggle direct messages                                                                 |
| `SLACK_ENABLE_CHANNEL_MENTIONS` | Toggle `@Baxter` in allowed channels                                                   |

Bots, Baxter's own messages, and unsupported subtypes (edits, joins, etc.) are ignored.

---

## Message formatting

Responses use Slack mrkdwn:

```
*Baxter*

Answer text.

*Sources*
• <https://docs.google.com/...|Project Brief> — Google Doc
• <https://acton-baxter.vercel.app/knowledge/...|Process Doc> — Knowledge Base

_Answer type: Approved Acton knowledge_
```

- Unsafe markup escaped (`<!channel>`, `@everyone`, etc.)
- Source URLs from validated server records only — never from model output
- Long answers split at ~3500 characters without breaking links
- Sources and answer-type line appear in the final segment when split
- Empty `@Baxter` mention → short prompt, no AI call

---

## Health statuses

Evaluated by `evaluateSlackHealth()` and shown at `/admin/slack`:

| Status          | Meaning                                                  |
| --------------- | -------------------------------------------------------- |
| `disabled`      | `ENABLE_SLACK_INTEGRATION=false` — web Baxter unaffected |
| `misconfigured` | Missing signing secret, bot token, or team IDs           |
| `ready`         | Credentials present; auth test passed (or not yet run)   |
| `warning`       | Configured but recent event/posting errors recorded      |
| `offline`       | Slack `auth.test` failed — token revoked or invalid      |

---

## Admin routes

| Route                                        | Purpose                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/admin/slack`                               | **Activity** (default): users & channels with human names; Health & Settings tabs for diagnostics |
| `/admin/slack/users/[teamId]/[slackUserId]`  | User activity grouped by Direct Message / channel                                                 |
| `/admin/slack/channels/[teamId]/[channelId]` | Channel activity and participants                                                                 |
| `/admin/slack/conversations/[id]`            | Conversation detail — chat-style history, sources, safe error codes                               |

### Display names

Baxter caches Slack display metadata in `slack_user_profiles` and `slack_channel_profiles` (migration **019**).

Resolution order for people: `profile.display_name` → `real_name` → username → “Unknown Slack user”.

Channels: DMs → “Direct Message”; otherwise `#name` when known; private/unresolved → “Private channel”.

Use **Refresh Slack names** on the Activity tab to backfill historical IDs (bounded, rate-limit safe). Name resolution never blocks answering Slack messages.

Required bot scopes for name resolution: `users:read`, `users.profile:read`, `channels:read`. For the 👀 processing indicator: `reactions:write`. After adding scopes, **reinstall** the Slack app. Optional `groups:read` only if private-channel names are required in admin Activity.

Diagnostic actions (admin only, under Health):

- Test Slack authentication
- Post test message to a channel or user ID
- Process one pending `slack_baxter_reply` job
- Test complete Baxter answer pipeline without public post

Secrets are never displayed — only present/absent indicators.

---

## Supported interactions

| Interaction                  | Supported                            |
| ---------------------------- | ------------------------------------ |
| Direct messages              | Yes — free-form conversation         |
| `@Baxter` in allowed channel | Yes — replies in thread              |
| Thread follow-up in DM       | Yes — no re-mention needed           |
| Thread follow-up in channel  | Requires `@Baxter` again (default)   |
| `/property` slash command    | Yes — Property Research flow         |
| `/clear` slash command       | Yes — reset Baxter conversation      |
| `/help` slash command        | Yes — capabilities and examples      |
| `/recall` slash command      | Yes — live Slack history search      |
| `/pem` slash command         | Yes — opens Baxter web PEM NEAT tool |
| Bot-to-bot messages          | Ignored                              |
| Duplicate Slack retries      | Deduped safely                       |

---

## Ignored events

- Messages with `bot_id`
- Baxter's own replies
- Unsupported subtypes (`message_changed`, channel join, etc.)
- Disallowed teams, channels, or users
- Empty or whitespace-only mentions (handled with a prompt instead)

---

## Error responses

Employees see safe messages with reference codes:

> Baxter couldn't complete that response right now. Please try again in a few minutes. Reference: BAXTER_SLACK_POST_FAILED

Bot tokens and signing secrets never appear in logs or client-facing errors.

Full code list: `docs/slack-setup.md` section K.

---

## API routes

| Route                          | Method | Purpose                            |
| ------------------------------ | ------ | ---------------------------------- |
| `/api/slack/events`            | POST   | Events API (DMs, mentions)         |
| `/api/slack/commands/property` | POST   | `/property` slash command          |
| `/api/slack/commands/clear`    | POST   | `/clear` slash command             |
| `/api/slack/commands/help`     | POST   | `/help` slash command              |
| `/api/slack/commands/recall`   | POST   | `/recall` slash command            |
| `/api/slack/commands/pem`      | POST   | `/pem` — open Baxter PEM NEAT tool |
| `/api/slack/interactions`      | POST   | Reserved for interactive payloads  |

Manifest: `docs/slack-app-manifest.yaml`

---

## Slash commands (quick reference)

| Route                          | Purpose                                                | Slash Command     |
| ------------------------------ | ------------------------------------------------------ | ----------------- |
| `/api/slack/commands/property` | Start Property Research workflow                       | `/property`       |
| `/api/slack/commands/clear`    | Clear Baxter conversation context                      | `/clear`          |
| `/api/slack/commands/help`     | Show Baxter help and capabilities                      | `/help`           |
| `/api/slack/commands/pem`      | Open Baxter’s Partnership Evaluation Meeting NEAT tool | `/pem`            |
| `/api/slack/commands/recall`   | Explicitly search Slack history                        | `/recall`         |
| `/api/slack/interactions`      | Reserved (no PEM modal)                                | _(interactivity)_ |

Plain-text `/clear` and `/help` in DMs still work via the Events API. Slash commands are shortcuts that use the same underlying Baxter logic.

- `/help` — always works; no Slack Search OAuth; no OpenAI.
- `/clear` — resets conversation using Slack user/thread identity only; no Slack Search OAuth.
- `/recall` — forces live Slack retrieval. Public history can use the bot path; private channels/DMs need the employee’s Slack Search link under Settings → Integrations.
- `/pem` — returns a link/button to `/pem-neats/new` because full meeting transcripts exceed practical Slack modal input limits (~3000 characters). **Does not require Slack Search OAuth.** Generation stays in the Baxter web app.
