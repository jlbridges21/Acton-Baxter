# Slack setup — Baxter production (Prompt 5B)

This guide walks through configuring Baxter in the Acton ADU Slack workspace from start to finish. Jackson (or any admin with Vercel access) should be able to complete setup using only this document and the manifest at `docs/slack-app-manifest.yaml`.

For technical architecture, see `docs/slack-bot.md`.

---

## A. Prerequisites

Before you begin, confirm all of the following:

| Requirement                 | Details                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Acton Slack workspace       | Admin or permission to create and install custom Slack apps                               |
| Vercel access               | Ability to edit Production (and optionally Preview) environment variables                 |
| Production URL              | `https://acton-baxter.vercel.app`                                                         |
| Supabase migrations         | All migrations through **009** applied (see section I)                                    |
| Baxter web chat             | Working on `/` with `BAXTER_CHAT_ENABLED=true` and valid `OPENAI_API_KEY`                 |
| OpenAI                      | `OPENAI_API_KEY` set in Vercel; test at `/admin/baxter/diagnostics`                       |
| Google connector (optional) | Sync approved Docs/Sheets at `/admin/connectors/google` for clickable Google source links |

---

## B. Create the Slack app

1. Open **Slack API → Your Apps**: https://api.slack.com/apps
2. Click **Create New App**.
3. Choose **From a manifest**.
4. Select the **Acton ADU** workspace.
5. Paste the contents of `docs/slack-app-manifest.yaml` (or upload the file if Slack offers that option).
6. Review and create the app.

### App identity

| Field            | Value                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| App name         | **Baxter**                                                                                                                |
| Description      | Acton ADU's internal AI assistant for approved company knowledge, procedures, processes, and general employee assistance. |
| Bot display name | **Baxter**                                                                                                                |
| App icon         | Upload `public/baxter/avatar.png` (Baxter avatar asset in the repo)                                                       |

### About `baxter@actonadu.com`

Use **baxter@actonadu.com** as the **administrative owner contact** for the Slack app (app settings, billing contact, or workspace admin identity). This is **not** how the bot authenticates.

- The bot uses a **Bot User OAuth Token** (`xoxb-...`) stored in Vercel as `SLACK_BOT_TOKEN`.
- The bot does **not** log in with an email/password.
- Do not confuse the Google Workspace service account (`baxter@actonadu.com`) with Slack bot credentials — they are separate systems.

---

## C. App manifest

The canonical manifest lives at:

```
docs/slack-app-manifest.yaml
```

### Summary

| Setting                 | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| App name                | Baxter                                                        |
| Bot user                | Baxter (always online)                                        |
| Slash command           | `/property`                                                   |
| Events request URL      | `https://acton-baxter.vercel.app/api/slack/events`            |
| `/property` request URL | `https://acton-baxter.vercel.app/api/slack/commands/property` |
| Bot events              | `app_mention`, `message.im`                                   |
| Socket Mode             | Disabled                                                      |
| Interactivity           | Disabled                                                      |

After creating the app from the manifest, open **Event Subscriptions** in the Slack app settings and confirm the Request URL shows **Verified**. Slack sends a `url_verification` challenge; Baxter responds automatically when `SLACK_SIGNING_SECRET` is configured.

If you change scopes or events later, update the manifest file, re-import it, and **reinstall** the app to the workspace (section F).

---

## D. Required OAuth scopes

Scopes are defined in `docs/slack-app-manifest.yaml`. Separate them as follows:

### Required

| Scope               | Why                                    |
| ------------------- | -------------------------------------- |
| `app_mentions:read` | Receive `@Baxter` mentions in channels |
| `chat:write`        | Post replies in DMs and threads        |
| `im:history`        | Receive direct messages to Baxter      |
| `commands`          | Handle the `/property` slash command   |

### Optional

| Scope        | Why                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `users:read` | Resolve Slack display names for admin diagnostics (`users.info`). **Not required** — Baxter works with Slack user IDs only. |

### Do NOT include (default pilot configuration)

| Scope              | Why omitted                                                |
| ------------------ | ---------------------------------------------------------- |
| `channels:history` | Would allow reading all channel messages without `@Baxter` |
| `groups:history`   | Same for private channels                                  |
| `mpim:history`     | Not needed for current interaction model                   |

**Tradeoff:** Without `channels:history` / `groups:history`, Baxter **cannot** see unmentioned thread replies in channels. Employees must `@Baxter` again for each channel follow-up. DMs work as normal free-form conversation. This is the **secure default** for the initial pilot.

If you later add `channels:history` and subscribe to `message.channels`, document the privacy tradeoff and update the manifest — do not add broad history scopes unless explicitly approved.

---

## E. Event subscriptions

### Enable Events

1. In the Slack app settings, open **Event Subscriptions**.
2. Turn **Enable Events** on.
3. Set **Request URL** to:

   ```
   https://acton-baxter.vercel.app/api/slack/events
   ```

4. Wait for Slack to verify the URL (green checkmark).

### URL verification

Slack sends a `url_verification` payload with a `challenge` string. Baxter verifies the request signature using `SLACK_SIGNING_SECRET` and returns the challenge. URL verification works even when `ENABLE_SLACK_INTEGRATION=false`, as long as the signing secret is valid.

### Subscribed bot events

| Event         | Behavior                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `app_mention` | Employee mentions `@Baxter` in an allowed channel → Baxter replies **in a thread** attached to that message |
| `message.im`  | Employee sends a DM → Baxter replies directly in the DM                                                     |

### How interactions work

| Context     | First message        | Follow-ups                                                             |
| ----------- | -------------------- | ---------------------------------------------------------------------- |
| **DM**      | Free-form text       | Free-form — no `@Baxter` required                                      |
| **Channel** | `@Baxter <question>` | **Must `@Baxter` again** for each follow-up (mention-required default) |

Baxter always replies in the associated thread in channels so the main channel stays uncluttered.

### Retries and deduplication

Slack retries failed event deliveries. Baxter uses durable deduplication via the `slack_event_receipts` table (migration 009):

1. Each Slack `event_id` is claimed once.
2. Duplicate deliveries return HTTP 200 with `duplicate: true` — **no second reply**.
3. Receipt statuses: `received`, `processing`, `completed`, `failed`, `ignored`.
4. Failed events record a `BAXTER_SLACK_*` error code for admin review.

---

## F. Install the app

1. In the Slack app settings, open **Install App** (or **OAuth & Permissions** → **Install to Workspace**).
2. Review requested permissions and click **Allow**.
3. Copy the **Bot User OAuth Token** (`xoxb-...`) → Vercel `SLACK_BOT_TOKEN`.
4. Open **Basic Information** → **App Credentials** → copy **Signing Secret** → Vercel `SLACK_SIGNING_SECRET`.
5. Find the **Workspace / Team ID** (starts with `T`):
   - Slack app settings → **Basic Information** → **App Credentials**, or
   - Click the workspace name in Slack → **Settings & administration** → **Workspace settings** → URL contains the team ID.
6. Find **channel IDs** (start with `C` or `G` for private channels):
   - Right-click a channel → **View channel details** → scroll to the bottom, or
   - Open the channel in Slack web — the ID is in the URL.
7. Find **user IDs** (start with `U`):
   - Click a member profile → **⋯** → **Copy member ID** (requires appropriate Slack permissions).
8. **Invite Baxter** to each approved channel: `/invite @Baxter` (or add the app from channel settings).
9. After any scope or event change, **reinstall** the app and update Vercel tokens if Slack rotates them.

---

## G. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Redeploy after any change.

**Format rules:**

- Comma-separated IDs: `T123ABC,C456DEF` — **no quotes**, no spaces around commas (trimmed automatically).
- Boolean values: `true` or `false`.
- Secrets: paste raw values; do not wrap in quotes unless the value itself contains special characters Slack gave you that way (rare).

### Complete table

| Variable                        | Required                 | Example / notes                                                                   |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `ENABLE_SLACK_INTEGRATION`      | Yes (to enable)          | `true`                                                                            |
| `SLACK_SIGNING_SECRET`          | Yes when enabled         | From Slack app credentials                                                        |
| `SLACK_BOT_TOKEN`               | Yes when enabled         | `xoxb-...` Bot User OAuth Token                                                   |
| `SLACK_APP_TOKEN`               | No                       | `xapp-...` — only for future Socket Mode; leave empty                             |
| `SLACK_ALLOWED_TEAM_IDS`        | Yes when enabled         | `T0123456789` — Acton workspace team ID                                           |
| `SLACK_ALLOWED_CHANNEL_IDS`     | No                       | `C111,C222` — **empty = channel mentions disabled** (safe pilot default)          |
| `SLACK_ALLOWED_USER_IDS`        | No                       | `U111,U222` — **empty = all humans in allowed workspace**                         |
| `SLACK_ENABLE_DMS`              | No (default `true`)      | `true` — allow direct messages                                                    |
| `SLACK_ENABLE_CHANNEL_MENTIONS` | No (default `true`)      | `true` — allow `@Baxter` in allowed channels                                      |
| `SLACK_REPORT_USER_ID`          | For `/property` only     | Supabase profile UUID for report attribution — **not required for Q&A**           |
| `SLACK_COMMAND_NAME`            | No (default `/property`) | Slash command name                                                                |
| `NEXT_PUBLIC_APP_URL`           | Recommended              | `https://acton-baxter.vercel.app` — used for Knowledge Base source links in Slack |
| `APP_BASE_URL`                  | Alternative              | Same production URL if `NEXT_PUBLIC_APP_URL` is unset                             |
| `OPENAI_API_KEY`                | Yes for AI answers       | Required for Baxter Q&A                                                           |
| `BAXTER_CHAT_ENABLED`           | Yes                      | `true`                                                                            |
| `BAXTER_LLM_PROVIDER`           | Yes                      | `openai`                                                                          |
| `BAXTER_OPENAI_MODEL`           | No                       | `gpt-4o-mini` (default)                                                           |
| `INTERNAL_CRON_SECRET`          | Yes                      | Long random string — secures `/api/internal/process-jobs` cron                    |

### Pilot starter configuration

```bash
ENABLE_SLACK_INTEGRATION=true
SLACK_SIGNING_SECRET=<from Slack app>
SLACK_BOT_TOKEN=xoxb-<from Slack app>
SLACK_ALLOWED_TEAM_IDS=T<Acton team ID>
SLACK_ALLOWED_CHANNEL_IDS=
SLACK_ALLOWED_USER_IDS=
SLACK_ENABLE_DMS=true
SLACK_ENABLE_CHANNEL_MENTIONS=true
SLACK_REPORT_USER_ID=<uuid for /property attribution>
NEXT_PUBLIC_APP_URL=https://acton-baxter.vercel.app
OPENAI_API_KEY=<OpenAI key>
BAXTER_CHAT_ENABLED=true
BAXTER_LLM_PROVIDER=openai
BAXTER_OPENAI_MODEL=gpt-4o-mini
INTERNAL_CRON_SECRET=<long random string>
```

Start with **empty** `SLACK_ALLOWED_CHANNEL_IDS` (DMs only). Add channel IDs after inviting Baxter to a pilot channel.

### Which Vercel environments

| Variable              | Production     | Preview                                  | Development             |
| --------------------- | -------------- | ---------------------------------------- | ----------------------- |
| All Slack secrets     | Yes            | Optional (separate test app recommended) | Local `.env.local`      |
| `NEXT_PUBLIC_APP_URL` | Production URL | Preview URL                              | `http://localhost:3000` |

Always **redeploy** Production after changing Production variables.

---

## H. Vercel configuration

1. Add all variables from section G to the appropriate Vercel environments.
2. **Redeploy** the Production deployment (Deployments → ⋯ → Redeploy).
3. Confirm the app loads at `https://acton-baxter.vercel.app`.
4. Confirm routes respond:
   - Events: `POST https://acton-baxter.vercel.app/api/slack/events` (Slack verifies automatically)
   - Property command: `POST https://acton-baxter.vercel.app/api/slack/commands/property`
5. Check **Vercel → Logs** after sending a test DM for errors.

### Cron / async job processing

Baxter acknowledges Slack events within seconds, then processes AI replies asynchronously.

| Mechanism       | Details                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| **Immediate**   | Next.js `after()` processes the `slack_baxter_reply` job right after acknowledging the event            |
| **Cron backup** | Vercel Cron runs every **2 minutes**: `*/2 * * * *` on `/api/internal/process-jobs` (see `vercel.json`) |
| **Auth**        | Cron requests must include `Authorization: Bearer <INTERNAL_CRON_SECRET>`                               |

If a reply is delayed, check `/admin/slack` for pending jobs and trigger **Process one pending Slack job** from the diagnostics panel.

---

## I. Supabase configuration

### Required migration

Run in Supabase SQL Editor (in order with all prior migrations):

```
supabase/migrations/009_slack_production.sql
```

This migration:

- Adds `slack_baxter_reply` to the allowed `report_jobs.job_type` values
- Creates `slack_event_receipts` for durable Events API deduplication

### Confirm migration applied

```sql
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'slack_event_receipts'
);
```

Should return `true`.

Also confirm `009` is in your applied migration history alongside 001–008.

### RLS and access

- `slack_event_receipts`: RLS enabled; **admins** can read via `is_admin()` policy; **service role** inserts/updates server-side.
- Baxter conversations: stored in `baxter_conversations` with `channel = 'slack'`.
- Slack users: `external_user_id` = Slack user ID; `user_id` = **null** (no fake Supabase users).
- Thread mapping: `external_thread_id` = `team:channel:user` (DM) or `team:channel:thread_ts` (channel thread).

### Inspect recent Slack activity

- Admin UI: `/admin/slack` and `/admin/slack/conversations/[id]`
- SQL (admins / service role):

```sql
select event_id, status, event_type, received_at, last_error_code
from public.slack_event_receipts
order by received_at desc
limit 20;
```

---

## J. Testing checklist

Complete every item before expanding the pilot.

1. Open Baxter's Slack profile or App Home and start a **DM**.
2. Send: **"Who is Baxter?"**
3. Confirm a useful **identity** answer (no Knowledge Base required).
4. Send: **"What is an ADU?"**
5. Confirm a useful **general** answer without fake official sources.
6. Ask an **approved Acton question** supported by the Knowledge Base or Google sync.
7. Confirm the reply includes a **clickable source** link (Google Doc/Sheet or `/knowledge/...` URL).
8. In an **approved channel** (listed in `SLACK_ALLOWED_CHANNEL_IDS`), send: `@Baxter who are you?`
9. Confirm Baxter replies **in a thread**, not as a main-channel message.
10. In the same thread, send a follow-up **with `@Baxter`** (e.g. `@Baxter tell me more`).
11. Ask an **unsupported official policy question** (e.g. "What is Acton's official bereavement policy?").
12. Confirm Baxter **does not invent policy** — mixed/general guidance is clearly labeled.
13. Trigger or simulate a **duplicate Slack event** (retry) — confirm only **one** Baxter reply exists.
14. Run **`/property 655 13th St, San Jose, CA`** — confirm acknowledgment and completion with a report link.
15. Open **`/admin/slack`** — confirm the interaction appears in recent activity with status and source count.
16. Confirm any error messages show a **`BAXTER_*` or `BAXTER_SLACK_*` reference code** and **never** expose tokens or secrets.

---

## K. Troubleshooting

| Symptom                          | Likely cause                                        | Fix                                                                                                                    |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| URL verification fails           | Wrong signing secret, app not deployed, or URL typo | Set `SLACK_SIGNING_SECRET`, redeploy, re-verify in Slack app settings                                                  |
| `dispatch_failed` in Slack       | Endpoint timeout or 5xx                             | Check Vercel logs; confirm deployment is healthy                                                                       |
| `invalid_auth` / `token_revoked` | Bad or rotated bot token                            | Copy fresh `xoxb-` token, update `SLACK_BOT_TOKEN`, redeploy → `BAXTER_SLACK_AUTH_FAILED`                              |
| `missing_scope`                  | Scope added in code but app not reinstalled         | Reinstall app; update manifest → `BAXTER_SLACK_MISSING_SCOPE`                                                          |
| `not_in_channel`                 | Baxter not invited to channel                       | `/invite @Baxter` in the channel → `BAXTER_SLACK_NOT_IN_CHANNEL`                                                       |
| `channel_not_found`              | Wrong channel ID or deleted channel                 | Verify channel ID → `BAXTER_SLACK_CHANNEL_NOT_FOUND`                                                                   |
| Team rejected                    | Wrong workspace                                     | Add team ID to `SLACK_ALLOWED_TEAM_IDS` → `BAXTER_SLACK_TEAM_NOT_ALLOWED`                                              |
| `signature_invalid`              | Signing secret mismatch                             | Re-copy signing secret → `BAXTER_SLACK_SIGNATURE_INVALID`                                                              |
| `timestamp_invalid`              | Clock skew or replay (>5 min old)                   | Retry; check server time → `BAXTER_SLACK_TIMESTAMP_INVALID`                                                            |
| Slack retries repeatedly         | Endpoint returning non-200 or timing out            | Fix underlying error; duplicates are safe once dedupe works                                                            |
| Duplicate Baxter replies         | Dedupe not working                                  | Confirm migration 009 applied; check `slack_event_receipts` → `BAXTER_SLACK_EVENT_DUPLICATE` should prevent duplicates |
| DMs not received                 | DMs disabled or integration off                     | Set `SLACK_ENABLE_DMS=true`, `ENABLE_SLACK_INTEGRATION=true`                                                           |
| Mentions not received            | Channel not allowlisted or mentions disabled        | Add channel to `SLACK_ALLOWED_CHANNEL_IDS`; set `SLACK_ENABLE_CHANNEL_MENTIONS=true`                                   |
| Baxter posts but does not answer | OpenAI or job failure                               | Check `/admin/slack` and `/admin/baxter/diagnostics`                                                                   |
| OpenAI errors                    | Missing/invalid key                                 | Set `OPENAI_API_KEY` → `BAXTER_OPENAI_*` codes                                                                         |
| No Knowledge Base sources        | No approved matching entries                        | Approve entries at `/admin/knowledge`; sync Google at `/admin/connectors/google`                                       |
| Source links do not open         | Wrong `NEXT_PUBLIC_APP_URL` or invalid URL          | Set production URL; links must be `https://`                                                                           |
| Variables not applied            | Forgot redeploy                                     | Redeploy after every Vercel env change                                                                                 |
| Private channel issues           | Baxter not in channel or ID is `G...`               | Invite Baxter; use private channel ID in allowlist                                                                     |
| Long responses truncated badly   | Message splitting issue                             | Baxter splits at ~3500 chars; sources stay in final segment                                                            |
| Rate limiting                    | Too many API calls                                  | Wait and retry → `BAXTER_SLACK_RATE_LIMITED`                                                                           |
| Channel mention ignored          | Empty allowlist                                     | Add channel ID to `SLACK_ALLOWED_CHANNEL_IDS` → `BAXTER_SLACK_CHANNEL_NOT_ALLOWED`                                     |
| User blocked                     | User allowlist active                               | Add user ID or clear `SLACK_ALLOWED_USER_IDS` → `BAXTER_SLACK_USER_NOT_ALLOWED`                                        |

### Baxter Slack error codes

| Code                               | Meaning                          |
| ---------------------------------- | -------------------------------- |
| `BAXTER_SLACK_SIGNATURE_INVALID`   | Request signature did not match  |
| `BAXTER_SLACK_TIMESTAMP_INVALID`   | Request too old or bad timestamp |
| `BAXTER_SLACK_TEAM_NOT_ALLOWED`    | Workspace not in allowlist       |
| `BAXTER_SLACK_EVENT_DUPLICATE`     | Retry safely ignored             |
| `BAXTER_SLACK_EVENT_UNSUPPORTED`   | Event type or subtype ignored    |
| `BAXTER_SLACK_JOB_FAILED`          | Background job failed            |
| `BAXTER_SLACK_POST_FAILED`         | `chat.postMessage` failed        |
| `BAXTER_SLACK_AUTH_FAILED`         | Bot token invalid or revoked     |
| `BAXTER_SLACK_RATE_LIMITED`        | Slack API rate limit             |
| `BAXTER_SLACK_CHANNEL_NOT_FOUND`   | Channel does not exist           |
| `BAXTER_SLACK_NOT_IN_CHANNEL`      | Baxter not in channel            |
| `BAXTER_SLACK_MISSING_SCOPE`       | App missing OAuth scope          |
| `BAXTER_SLACK_CHANNEL_NOT_ALLOWED` | Channel not in allowlist         |
| `BAXTER_SLACK_USER_NOT_ALLOWED`    | User not in allowlist            |
| `BAXTER_SLACK_DMS_DISABLED`        | DMs turned off in config         |
| `BAXTER_SLACK_MENTIONS_DISABLED`   | Channel mentions turned off      |
| `BAXTER_SLACK_DISABLED`            | Integration disabled             |
| `BAXTER_SLACK_MISCONFIGURED`       | Missing required credentials     |

Admin diagnostics: `/admin/slack`

---

## L. Security checklist

- [ ] Never commit `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, or `INTERNAL_CRON_SECRET` to git
- [ ] Rotate any token that was pasted into chat, email, or a screenshot
- [ ] Set `SLACK_ALLOWED_TEAM_IDS` to the Acton workspace only — never leave empty in production
- [ ] Start pilot with **empty** `SLACK_ALLOWED_CHANNEL_IDS` (DMs only), then add channels explicitly
- [ ] Use `SLACK_ALLOWED_USER_IDS` for a restricted pilot if needed
- [ ] Do not add `channels:history`, `groups:history`, or other broad scopes without explicit approval
- [ ] Keep the app **internal** — do not publish to the Slack App Directory
- [ ] Review Vercel function logs periodically for accidental secret leakage
- [ ] Never paste signing secrets or bot tokens into Slack messages
- [ ] Remove former employees from the workspace or tighten `SLACK_ALLOWED_USER_IDS`
- [ ] Revoke and regenerate tokens if app ownership or admin access changes
- [ ] Confirm `/admin/slack` shows secrets as **Yes/No** only, never raw values

---

## M. Pilot rollout

Recommended initial private pilot participants (documentation only — **not hardcoded** in application logic):

- Jackson
- Milan
- Maxx
- James

### Rollout steps

1. **Week 1 — DMs only:** Leave `SLACK_ALLOWED_CHANNEL_IDS` empty. Pilot users DM Baxter directly.
2. **Week 1–2 — One private channel:** Add one channel ID to `SLACK_ALLOWED_CHANNEL_IDS`, invite `@Baxter`, test `@Baxter` mentions and thread replies.
3. **Collect feedback:** Note wrong, incomplete, or missing answers.
4. **Improve sources:** Add or approve Knowledge Base entries; sync Google Docs at `/admin/connectors/google`.
5. **Review errors:** Check `/admin/slack` daily for failed receipts or jobs.
6. **Expand access:** Add more channel IDs or clear user restrictions after successful testing.
7. **Optional:** Tighten or loosen `SLACK_ALLOWED_USER_IDS` based on pilot results.

Do not enable all channels until mention behavior, source links, and error handling are validated.

---

## Related documentation

- `docs/slack-bot.md` — architecture and behavior
- `docs/slack-app-manifest.yaml` — importable Slack manifest
- `docs/baxter-troubleshooting.md` — Baxter AI and Slack troubleshooting
- `/admin/slack` — live health and diagnostics
