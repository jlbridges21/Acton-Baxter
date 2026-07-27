# Slack setup — Baxter production

This guide walks through configuring Baxter in the Acton ADU Slack workspace from start to finish. Jackson (or any admin with Vercel access) should be able to complete setup using only this document and the manifest at `docs/slack-app-manifest.yaml`.

For technical architecture, see `docs/slack-bot.md`. For employee usage, see `docs/baxter-employee-guide.md`.

Production URL: **`https://acton-baxter.vercel.app`**

---

## 1. What Baxter does in Slack

Baxter is Acton ADU’s internal AI assistant. In Slack it:

| Feature               | How employees use it                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Q&A (DMs)**         | Message Baxter directly — no `@Baxter` required in DMs                                                      |
| **Q&A (channels)**    | `@Baxter <question>` in an allowed channel; replies appear **in a thread**                                  |
| **Clear context**     | Send `/clear` in a DM or thread — starts a fresh conversation (plain text; no slash-command config needed)  |
| **Property Research** | `/property [address]` — same PEM research as the web tool; returns a login-protected link (no PDF in Slack) |

Baxter reuses the same `answerBaxterQuestion()` backend as web chat. Answers may include **Sources** (approved Knowledge Base / Google-synced docs) or clearly labeled **general guidance**. Baxter never invents official Acton policy or fake URLs.

**Important:** Slack Q&A does **not** require a Supabase user profile for each Slack employee. Baxter stores Slack user IDs with `user_id = null` in conversations. **`SLACK_REPORT_USER_ID` is optional** and applies **only** to `/property` report ownership — if unset, the code uses the **first admin profile**.

---

## 2. Prerequisites

Before you begin, confirm all of the following:

| Requirement                    | Details                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| Acton Slack workspace          | Admin or permission to create and install custom Slack apps               |
| Vercel access                  | Ability to edit Production environment variables                          |
| Production URL                 | `https://acton-baxter.vercel.app`                                         |
| Supabase migrations            | All migrations **001–010** applied (see section 15)                       |
| Baxter web chat                | Working on `/` with `BAXTER_CHAT_ENABLED=true` and valid `OPENAI_API_KEY` |
| OpenAI                         | Test at `/admin/baxter/diagnostics`                                       |
| Knowledge Base                 | At least one approved entry (manual or Google sync)                       |
| Google connector (recommended) | Sync approved Docs/Sheets at `/admin/connectors/google`                   |

---

## 3. Create the Slack app

1. Open **Slack API → Your Apps**: https://api.slack.com/apps
2. Click **Create New App**.
3. Choose **From a manifest**.
4. Select the **Acton ADU** workspace.
5. Paste the contents of `docs/slack-app-manifest.yaml`.
6. Review and create the app.

---

## 4. App manifest

The canonical manifest lives at `docs/slack-app-manifest.yaml`. After creating the app, confirm these values match Slack app settings:

| Setting                 | Value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| App name                | Baxter                                                        |
| Slash command           | `/property`                                                   |
| Events request URL      | `https://acton-baxter.vercel.app/api/slack/events`            |
| `/property` request URL | `https://acton-baxter.vercel.app/api/slack/commands/property` |
| Bot events              | `app_mention`, `message.im`                                   |
| Socket Mode             | **Disabled**                                                  |
| Interactivity           | **Disabled**                                                  |

If you change scopes or events later, update the manifest file, re-import it, and **reinstall** the app (section 10).

---

## 5. Basic information

| Field             | Value                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| App name          | **Baxter**                                                                                                                |
| Short description | Acton ADU's internal AI assistant for approved company knowledge, procedures, processes, and general employee assistance. |
| Bot display name  | **Baxter**                                                                                                                |
| Background color  | `#0B1F33` (from manifest)                                                                                                 |

### About `baxter@actonadu.com`

Use **baxter@actonadu.com** as the **administrative owner contact** for the Slack app (app settings, billing contact). This is **not** how the bot authenticates.

- The bot uses a **Bot User OAuth Token** (`xoxb-...`) stored in Vercel as `SLACK_BOT_TOKEN`.
- The bot does **not** log in with email/password.
- Do not confuse the Google Workspace service account (`GOOGLE_CLIENT_EMAIL`, often `...@...iam.gserviceaccount.com`) with Slack bot credentials — they are separate systems.

---

## 6. App icon

Upload the Baxter avatar from the repo:

```
public/baxter/avatar.png
```

In Slack app settings → **Basic Information** → **Display Information** → upload the icon.

---

## 7. OAuth scopes (bot token)

**Required scopes** (must match `docs/slack-app-manifest.yaml`):

| Scope               | Why                                                        |
| ------------------- | ---------------------------------------------------------- |
| `app_mentions:read` | Receive `@Baxter` mentions in channels                     |
| `chat:write`        | Post replies in DMs and threads                            |
| `im:history`        | Receive direct messages to Baxter                          |
| `commands`          | Handle the `/property` slash command                       |
| `users:read`        | Resolve employee display names for `/admin/slack` Activity |
| `channels:read`     | Resolve public channel names for admin Activity            |

**Do NOT add** (secure pilot default):

| Scope              | Why omitted                                       |
| ------------------ | ------------------------------------------------- |
| `channels:history` | Would read all channel messages without `@Baxter` |
| `groups:history`   | Same for private channels                         |
| `users:read.email` | Not required — names do not need email            |
| `mpim:history`     | Not needed                                        |

**Tradeoff:** Without `channels:history`, Baxter **cannot** see unmentioned thread replies in channels. Employees must `@Baxter` again for each channel follow-up. DMs work as normal free-form conversation.

**After adding `users:read` / `channels:read`:** reinstall the Slack app so the bot token picks up the new scopes. Then open `/admin/slack` → **Refresh Slack names**.

---

## 8. Event subscriptions

1. Open **Event Subscriptions** in the Slack app settings.
2. Turn **Enable Events** on.
3. Set **Request URL** to:

   ```
   https://acton-baxter.vercel.app/api/slack/events
   ```

4. Wait for Slack to verify the URL (green checkmark). Baxter responds to `url_verification` when `SLACK_SIGNING_SECRET` is configured.

### Subscribed bot events (only these two)

| Event         | Behavior                                                |
| ------------- | ------------------------------------------------------- |
| `app_mention` | `@Baxter` in an allowed channel → reply **in a thread** |
| `message.im`  | DM to Baxter → reply in the DM                          |

### How interactions work

| Context     | First message        | Follow-ups                                  |
| ----------- | -------------------- | ------------------------------------------- |
| **DM**      | Free-form text       | Free-form — no `@Baxter` required           |
| **Channel** | `@Baxter <question>` | **Must `@Baxter` again** for each follow-up |

### Retries and deduplication

Slack retries failed deliveries. Baxter deduplicates via `slack_event_receipts` (migration 009): each `event_id` is processed once; duplicates return HTTP 200 with `duplicate: true`.

---

## 9. Slash command `/property`

Configured in the manifest:

| Field       | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| Command     | `/property`                                                   |
| Request URL | `https://acton-baxter.vercel.app/api/slack/commands/property` |
| Usage hint  | `[address]`                                                   |
| Description | Research a property address with Baxter Property Research     |

Example: `/property 655 13th St, San Jose, CA`

Baxter acknowledges immediately, runs Property Research asynchronously, and posts a login-protected report link when complete. Slack never receives a PDF attachment.

Report ownership: set `SLACK_REPORT_USER_ID` to an existing employee profile UUID, **or** leave unset and Baxter uses the **first admin profile**. No fake Supabase user is needed for Q&A.

---

## 10. Install the app

1. Open **Install App** (or **OAuth & Permissions** → **Install to Workspace**).
2. Review permissions and click **Allow**.
3. Copy credentials (sections 11–12).
4. After any scope or event change, **reinstall** and update Vercel tokens if Slack rotates them.

---

## 11. Signing secret

1. Open **Basic Information** → **App Credentials**.
2. Copy **Signing Secret**.
3. Set in Vercel as `SLACK_SIGNING_SECRET`.
4. Redeploy Production after setting (section 16).

Baxter verifies every Events API and slash-command request with this secret. Mismatch → `BAXTER_SLACK_SIGNATURE_INVALID`.

---

## 12. Bot token

1. After install, open **OAuth & Permissions**.
2. Copy **Bot User OAuth Token** (`xoxb-...`).
3. Set in Vercel as `SLACK_BOT_TOKEN`.
4. Redeploy Production after setting.

If you see `invalid_auth` or `token_revoked`, copy a fresh token after reinstall → `BAXTER_SLACK_AUTH_FAILED`.

### `SLACK_APP_TOKEN` (unused)

Socket Mode is **disabled**. **`SLACK_APP_TOKEN` is not used** — leave empty. Only needed if Socket Mode is enabled in the future.

---

## 13. Team, channel, and user IDs

| ID type              | Format                              | How to find                                                                |
| -------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| **Team / workspace** | `T...`                              | Slack app → Basic Information → App Credentials, or workspace settings URL |
| **Channel**          | `C...` (public) or `G...` (private) | Right-click channel → View channel details, or URL in Slack web            |
| **User**             | `U...`                              | Member profile → ⋯ → Copy member ID                                        |

Use these in Vercel allowlists (section 14).

---

## 14. Invite Baxter to channels

Before enabling channel mentions, invite Baxter to each pilot channel:

```
/invite @Baxter
```

Or add the app from channel settings. Without this, channel mentions fail with `not_in_channel` → `BAXTER_SLACK_NOT_IN_CHANNEL`.

---

## 15. Vercel environment variables

Set in **Vercel → Project → Settings → Environment Variables**. **Redeploy** after any change (section 16).

**Format rules:** comma-separated IDs with no spaces (`T123,C456`); booleans `true`/`false`; paste secrets raw (no quotes unless Slack provided them that way).

### Slack

| Variable                        | Required     | Notes                                               |
| ------------------------------- | ------------ | --------------------------------------------------- |
| `ENABLE_SLACK_INTEGRATION`      | Yes          | `true`                                              |
| `SLACK_SIGNING_SECRET`          | Yes          | From Slack app credentials                          |
| `SLACK_BOT_TOKEN`               | Yes          | `xoxb-...`                                          |
| `SLACK_APP_TOKEN`               | No           | **Unused** — Socket Mode disabled                   |
| `SLACK_ALLOWED_TEAM_IDS`        | Yes          | Acton workspace `T...`                              |
| `SLACK_ALLOWED_CHANNEL_IDS`     | No           | **Empty = channel mentions disabled** (safe pilot)  |
| `SLACK_ALLOWED_USER_IDS`        | No           | Empty = all humans in allowed workspace             |
| `SLACK_ENABLE_DMS`              | No           | Default `true`                                      |
| `SLACK_ENABLE_CHANNEL_MENTIONS` | No           | Default `true`                                      |
| `SLACK_REPORT_USER_ID`          | **Optional** | Profile UUID for `/property` only; else first admin |
| `SLACK_COMMAND_NAME`            | No           | Default `/property`                                 |

### Baxter AI + app URL

| Variable                       | Required    | Notes                                                     |
| ------------------------------ | ----------- | --------------------------------------------------------- |
| `OPENAI_API_KEY`               | Yes         | Required for Q&A                                          |
| `BAXTER_CHAT_ENABLED`          | Yes         | `true`                                                    |
| `BAXTER_LLM_PROVIDER`          | Yes         | `openai`                                                  |
| `BAXTER_OPENAI_MODEL`          | No          | Default `gpt-4o-mini`                                     |
| `BAXTER_OPENAI_FALLBACK_MODEL` | No          | Optional fallback on temporary rate limits                |
| `NEXT_PUBLIC_APP_URL`          | Recommended | `https://acton-baxter.vercel.app` — source links in Slack |
| `APP_BASE_URL`                 | Alternative | Same production URL if `NEXT_PUBLIC_APP_URL` unset        |

### Google scheduled sync

| Variable                       | Required        | Notes                                           |
| ------------------------------ | --------------- | ----------------------------------------------- |
| `GOOGLE_PROJECT_ID`            | If using Google | Google Cloud project                            |
| `GOOGLE_CLIENT_EMAIL`          | If using Google | Service account email                           |
| `GOOGLE_PRIVATE_KEY`           | If using Google | Normalized PEM (see `docs/google-connector.md`) |
| `GOOGLE_DRIVE_ROOT_FOLDER`     | If using Google | Root folder ID or URL                           |
| `GOOGLE_SYNC_ENABLED`          | No              | Default `true`                                  |
| `GOOGLE_SYNC_INTERVAL_MINUTES` | No              | Default `180` (min 15, max 1440)                |

### Cron

| Variable               | Required        | Notes                                                |
| ---------------------- | --------------- | ---------------------------------------------------- |
| `CRON_SECRET`          | Yes (preferred) | Secures `/api/internal/process-jobs` (Vercel Bearer) |
| `INTERNAL_CRON_SECRET` | Compatibility   | Used only if `CRON_SECRET` is unset                  |

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
# SLACK_REPORT_USER_ID=<optional uuid for /property only>
NEXT_PUBLIC_APP_URL=https://acton-baxter.vercel.app
OPENAI_API_KEY=<OpenAI key>
BAXTER_CHAT_ENABLED=true
BAXTER_LLM_PROVIDER=openai
BAXTER_OPENAI_MODEL=gpt-4o-mini
# BAXTER_OPENAI_FALLBACK_MODEL=gpt-4o-mini
GOOGLE_SYNC_ENABLED=true
GOOGLE_SYNC_INTERVAL_MINUTES=180
CRON_SECRET=<long random string>
# INTERNAL_CRON_SECRET=  # deprecated alias
```

Start with **empty** `SLACK_ALLOWED_CHANNEL_IDS` (DMs only). Add channel IDs after inviting Baxter to a pilot channel.

---

## 16. Supabase migration 009

Run in Supabase SQL Editor (after migrations 001–008):

```
supabase/migrations/009_slack_production.sql
```

Also run migration **010** for web feedback:

```
supabase/migrations/010_baxter_feedback.sql
```

Migration 009:

- Adds `slack_baxter_reply` to allowed `report_jobs.job_type` values
- Creates `slack_event_receipts` for durable Events API deduplication

Confirm applied:

```sql
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'slack_event_receipts'
);
```

Should return `true`.

---

## 17. Cron and async processing

Baxter acknowledges Slack events within seconds, then processes AI replies asynchronously.

| Mechanism       | Details                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| **Immediate**   | Next.js `after()` processes `slack_baxter_reply` right after acknowledging             |
| **Cron backup** | Vercel Cron on `/api/internal/process-jobs` (see `vercel.json`; Hobby ≤ daily)         |
| **Auth**        | `Authorization: Bearer <CRON_SECRET>` (legacy: `INTERNAL_CRON_SECRET`)                 |
| **Google sync** | Scheduled `google_knowledge_sync` when `GOOGLE_SYNC_ENABLED=true` and interval elapsed |

If a reply is delayed, check `/admin/slack` and trigger **Process one pending Slack job**.

---

## 18. Redeploy

After **every** Vercel env change:

1. Vercel → Deployments → ⋯ → **Redeploy** (Production).
2. Re-verify Events URL in Slack if signing secret changed.
3. Confirm routes respond:
   - `POST https://acton-baxter.vercel.app/api/slack/events`
   - `POST https://acton-baxter.vercel.app/api/slack/commands/property`
4. Check Vercel logs after a test DM.

---

## 19. Testing checklist

Complete every item before expanding the pilot.

1. DM Baxter: **"Who is Baxter?"** — useful identity answer (no KB required).
2. DM: **"What is an ADU?"** — general answer without fake official sources.
3. Ask an **approved Acton question** — reply includes **clickable source** link.
4. In an **allowed channel**, `@Baxter who are you?` — reply **in a thread**.
5. Thread follow-up **with `@Baxter`** — confirm mention required.
6. Unsupported official policy question — Baxter **does not invent policy**.
7. Simulate duplicate event / retry — **one** reply only.
8. **`/property 655 13th St, San Jose, CA`** — acknowledgment + report link.
9. **`/admin/slack`** — interaction in recent activity.
10. Errors show **`BAXTER_*` reference codes** — never tokens or secrets.
11. **`/admin/baxter/launch-readiness`** — acceptable overall status.

---

## 20. Troubleshooting

| Symptom                | Likely cause                           | Fix                                           |
| ---------------------- | -------------------------------------- | --------------------------------------------- |
| URL verification fails | Wrong signing secret or not deployed   | Set secret, redeploy, re-verify               |
| `dispatch_failed`      | Timeout or 5xx                         | Check Vercel logs                             |
| `invalid_auth`         | Bad bot token                          | Refresh `SLACK_BOT_TOKEN` after reinstall     |
| `missing_scope`        | App not reinstalled after scope change | Reinstall; update manifest                    |
| `not_in_channel`       | Baxter not invited                     | `/invite @Baxter`                             |
| Team rejected          | Wrong workspace                        | Add team ID to `SLACK_ALLOWED_TEAM_IDS`       |
| Duplicate replies      | Migration 009 missing                  | Apply migration; check `slack_event_receipts` |
| DMs not received       | DMs disabled                           | `SLACK_ENABLE_DMS=true`                       |
| Mentions ignored       | Empty channel allowlist                | Add channel ID to `SLACK_ALLOWED_CHANNEL_IDS` |
| OpenAI errors          | Missing key or quota                   | See `docs/baxter-troubleshooting.md`          |
| Source links broken    | Wrong app URL                          | Set `NEXT_PUBLIC_APP_URL`                     |
| Variables not applied  | Forgot redeploy                        | Redeploy Production                           |

### Baxter Slack error codes

| Code                               | Meaning                   |
| ---------------------------------- | ------------------------- |
| `BAXTER_SLACK_SIGNATURE_INVALID`   | Signature mismatch        |
| `BAXTER_SLACK_TIMESTAMP_INVALID`   | Request too old           |
| `BAXTER_SLACK_TEAM_NOT_ALLOWED`    | Workspace not allowlisted |
| `BAXTER_SLACK_EVENT_DUPLICATE`     | Retry safely ignored      |
| `BAXTER_SLACK_AUTH_FAILED`         | Bot token invalid         |
| `BAXTER_SLACK_NOT_IN_CHANNEL`      | Baxter not in channel     |
| `BAXTER_SLACK_CHANNEL_NOT_ALLOWED` | Channel not in allowlist  |
| `BAXTER_SLACK_USER_NOT_ALLOWED`    | User not in allowlist     |

Admin diagnostics: `/admin/slack` · Full Baxter AI: `docs/baxter-troubleshooting.md`

---

## 21. Pilot rollout

Recommended initial participants (documentation only — not hardcoded):

- Jackson
- Milan
- Maxx
- James

### Rollout steps

1. **Week 1 — DMs only:** Leave `SLACK_ALLOWED_CHANNEL_IDS` empty.
2. **Week 1–2 — One private channel:** Add one channel ID, invite `@Baxter`, test mentions.
3. **Collect feedback:** Web thumbs + pilot notes; review `/admin/baxter/feedback`.
4. **Improve sources:** Approve Knowledge Base entries; sync Google at `/admin/connectors/google`.
5. **Review errors:** Check `/admin/slack` daily.
6. **Expand access:** Add channels or clear user restrictions after validation.

Do not enable all channels until mention behavior, source links, and error handling are validated.

---

## 22. Security checklist

- [ ] Never commit `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, or `CRON_SECRET` / `INTERNAL_CRON_SECRET`
- [ ] Rotate any token pasted into chat, email, or screenshots
- [ ] Set `SLACK_ALLOWED_TEAM_IDS` to Acton workspace only — never empty in production
- [ ] Start pilot with **empty** `SLACK_ALLOWED_CHANNEL_IDS`
- [ ] Do not add `channels:history` or other broad scopes without approval
- [ ] Keep app **internal** — do not publish to Slack App Directory
- [ ] Do not create fake Supabase users for Slack Q&A
- [ ] Remove former employees from workspace or tighten `SLACK_ALLOWED_USER_IDS`

---

## 23. Employee usage guide (copy-paste)

Share this block with Acton employees (also in `docs/baxter-employee-guide.md`):

---

**Baxter — how to use in Slack**

**Direct message (easiest):** Open Baxter’s DM and ask anything. You do not need to `@Baxter` in DMs.

**In a channel:** Type `@Baxter` followed by your question. Baxter replies in a **thread** under your message. For follow-ups in a channel, **`@Baxter` again** — Baxter only sees messages that mention it in channels.

**Property research:** `/property 123 Main St, San Jose, CA` — Baxter researches the address and sends a link to the full report (sign in on the web to view).

**What to expect:**

- **Sources** = grounded in approved Acton docs (Google Docs/Sheets or Knowledge Base).
- **General guidance** = helpful context, **not** official Acton policy.
- Baxter will **not** invent company policies or fake document links.

**Property research from the web:** https://acton-baxter.vercel.app → Property Research Tool.

**Feedback:** On the web chat, use 👍 / 👎 on Baxter’s answers. In Slack, tell your admin if something is wrong or missing.

**Limitations:** Baxter does not search Buildertrend, GoHighLevel, or Domo in this version.

---

## 24. Maintenance

| Task                                | Frequency                 | Where                            |
| ----------------------------------- | ------------------------- | -------------------------------- |
| Review failed Slack jobs / receipts | Daily during pilot        | `/admin/slack`                   |
| Review negative web feedback        | Weekly                    | `/admin/baxter/feedback`         |
| Launch readiness check              | Before rollout expansion  | `/admin/baxter/launch-readiness` |
| Google sync health                  | Weekly                    | `/admin/connectors/google`       |
| OpenAI quota / billing              | When errors spike         | `/admin/baxter/diagnostics`      |
| Rotate tokens after admin change    | As needed                 | Vercel + Slack app settings      |
| Update manifest + reinstall         | When scopes/events change | `docs/slack-app-manifest.yaml`   |

---

## Related documentation

- `docs/slack-app-manifest.yaml` — importable Slack manifest
- `docs/slack-bot.md` — architecture and behavior
- `docs/baxter-employee-guide.md` — employee-facing guide
- `docs/baxter-troubleshooting.md` — OpenAI, Google, Slack troubleshooting
- `docs/production-checklist.md` — full production checklist
- `/admin/slack` — live health and diagnostics
