# Slack setup — Baxter production

This guide walks through configuring Baxter in the Acton ADU Slack workspace from start to finish. Jackson (or any admin with Vercel access) should be able to complete setup using only this document and the manifest at `docs/slack-app-manifest.yaml`.

For technical architecture, see `docs/slack-bot.md`. For employee usage, see `docs/baxter-employee-guide.md`.

Production URL: **`https://acton-baxter.vercel.app`**

---

## 1. What Baxter does in Slack

Baxter is Acton ADU’s internal AI assistant. In Slack it:

| Feature               | How employees use it                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Q&A (DMs)**         | Message Baxter directly — no `@Baxter` required in DMs                                                     |
| **Q&A (channels)**    | `@Baxter <question>` in an allowed channel; replies appear **in a thread**                                 |
| **Clear context**     | Send `/clear` in a DM or thread — starts a fresh conversation (plain text; no slash-command config needed) |
| **Property Research** | `/property [address]` — same research as the web tool; returns a login-protected link (no PDF in Slack)    |
| **New project setup** | `/new-project [customer name]` — search GHL, confirm, run live Master Log / Drive / Slack kickoff          |
| **Help**              | Send `/help` — capability summary                                                                          |
| **Clear / Help**      | `/clear`, `/help` — also available as plain-text commands in DMs                                           |
| **Slack recall**      | `/recall [query]` — explicit live Slack search (same pipeline as conversational recall)                    |
| **PEM NEAT**          | `/pem` — opens Baxter’s web PEM NEAT tool (transcripts are too long for Slack)                             |

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

| Setting                 | Value                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| App name                | Baxter                                                            |
| Slash commands          | `/property`, `/clear`, `/help`, `/recall`, `/pem`, `/new-project` |
| Events request URL      | `https://acton-baxter.vercel.app/api/slack/events`                |
| `/property` request URL | `https://acton-baxter.vercel.app/api/slack/commands/property`     |
| `/clear` request URL    | `https://acton-baxter.vercel.app/api/slack/commands/clear`        |
| `/help` request URL     | `https://acton-baxter.vercel.app/api/slack/commands/help`         |
| `/recall` request URL   | `https://acton-baxter.vercel.app/api/slack/commands/recall`       |
| `/pem` request URL      | `https://acton-baxter.vercel.app/api/slack/commands/pem`          |
| `/new-project` URL      | `https://acton-baxter.vercel.app/api/slack/commands/new-project`  |
| Interactivity URL       | `https://acton-baxter.vercel.app/api/slack/interactions`          |
| Bot events              | `app_mention`, `message.im`                                       |
| Socket Mode             | **Disabled**                                                      |
| Interactivity           | **Enabled** (required for `/new-project` modals)                  |

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

| Scope                | Why                                                                             |
| -------------------- | ------------------------------------------------------------------------------- |
| `app_mentions:read`  | Receive `@Baxter` mentions in channels                                          |
| `chat:write`         | Post replies in DMs and threads                                                 |
| `im:history`         | Receive direct messages to Baxter                                               |
| `commands`           | Handle the `/property` slash command                                            |
| `users:read`         | Resolve employee display names for `/admin/slack` Activity                      |
| `users.profile:read` | Prefer `profile.display_name` when resolving Slack user identity                |
| `channels:read`      | Resolve **public** channel names for admin Activity                             |
| `reactions:write`    | Add/remove Baxter’s 👀 processing reaction on the user message                  |
| `search:read.public` | Live Real-time Search of **public** channels (bot + action_token or user token) |
| `search:read.users`  | Include workspace users in Real-time Search results                             |
| `search:read.files`  | Include files in Real-time Search (optional but recommended)                    |
| `channels:history`   | Bounded thread / nearby context for public channels                             |
| `groups:history`     | History for **private** channels where Baxter is a member                       |
| `groups:read`        | Resolve/list private channel metadata (directory + membership)                  |

### User token scopes (Slack Search — per-employee OAuth)

These are **user scopes** (not bot scopes). Each employee who links Slack Search authorizes Baxter to search **only what that employee can see** in Slack:

| Scope                                                                 | Why                                  |
| --------------------------------------------------------------------- | ------------------------------------ |
| `search:read.public`                                                  | Public channel search                |
| `search:read.private`                                                 | Private channels the user belongs to |
| `search:read.im`                                                      | DMs the user can access              |
| `search:read.mpim`                                                    | Group DMs the user can access        |
| `search:read.users` / `search:read.files`                             | Users/files in search                |
| `users:read` / `users:read.email`                                     | Stable Baxter↔Slack identity mapping |
| `channels:history` / `groups:history` / `im:history` / `mpim:history` | Bounded thread context               |
| `channels:read` / `groups:read`                                       | Channel resolution                   |

OAuth redirect URL (add in Slack app → OAuth & Permissions → Redirect URLs):

`https://acton-baxter.vercel.app/api/slack/search/oauth/callback`

For local development (optional):

`http://localhost:3000/api/slack/search/oauth/callback`

**Manual step (required when Slack shows `redirect_uri did not match any configured URIs`):**

1. Open [api.slack.com/apps](https://api.slack.com/apps) → Baxter app.
2. **OAuth & Permissions** → **Redirect URLs**.
3. Add exactly: `https://acton-baxter.vercel.app/api/slack/search/oauth/callback`
4. Click **Save URLs**.
5. If you also changed **User Token Scopes**, click **Reinstall to Workspace** (required for scope changes; Save URLs alone is enough for redirect-only fixes).
6. In Baxter, open `/settings/integrations` → **Connect Slack Search** and complete the authorize flow.
7. Confirm `/admin/slack` shows the same OAuth callback URI under Slack Search diagnostics.

Baxter builds `redirect_uri` from **`SLACK_SEARCH_OAUTH_REDIRECT_URI`** when set, otherwise `${APP_BASE_URL}` / `${NEXT_PUBLIC_APP_URL}` + `/api/slack/search/oauth/callback`.

**Recommended Vercel env (production):**

```
SLACK_SEARCH_OAUTH_REDIRECT_URI=https://acton-baxter.vercel.app/api/slack/search/oauth/callback
```

Authorize URL and token exchange both call the same helper — they must stay identical. Redirect URL changes in Slack do **not** require reinstall; **User Token Scope** changes do.

Enable search with `ENABLE_SLACK_SEARCH=true`. Apply Supabase migration **029**. See `docs/slack-search.md` for architecture.

**Important:** Baxter does **not** copy Slack messages into Supabase. Search is live. Slack remains the source of truth.

Baxter adds 👀 **immediately after** accepting a Q&A event (post-dedupe), then removes it in a `finally` after the reply posts (or on terminal job failure). Reaction failures never block answers.

**Already added in Slack (Jackson):** `users:read`, `users.profile:read`, `channels:read`.

**Still needs a Slack app update + reinstall if eyes do not appear:** `reactions:write` (required for the 👀 processing indicator). After changing OAuth scopes, **reinstall/re-authorize** the app to the Acton workspace.

**Bot scopes to avoid for the conversational Q&A bot (not Search):** do not grant the bot blanket private-history scopes just for `@Baxter` chat. Live Slack Search uses a **separate** model:

- **Bot token:** public Real-time Search + public `channels:history` for thread context (see Bot Token Scopes table above and the manifest).
- **User token (per-employee OAuth):** private/DM/MPIM search + matching history scopes — listed in the User token scopes table. Those are intentional and required for `/recall` of private content.

Do **not** confuse “omit from bot” with “omit from user OAuth.”

### Optional: private channel names

`channels:read` covers **public** channels. If Baxter is invited to **private** channels and admins need those names (not `Private channel` / `Channel G…`) in Activity, add:

| Scope         | Why                                     |
| ------------- | --------------------------------------- |
| `groups:read` | Resolve private channel names via Slack |

Bot Token Scopes should include `groups:read` and `groups:history` for private channels Baxter is invited to. After adding scopes, **reinstall** the Slack app.

**Tradeoff:** Without `channels:history`, Baxter **cannot** see unmentioned thread replies in public channels. Without `groups:history`, Baxter cannot read private channels it belongs to. Employees must `@Baxter` again for each channel follow-up when history scopes are missing. DMs work as normal free-form conversation.

### After changing scopes

1. Update Bot Token Scopes in Slack (or re-import the manifest).
2. **OAuth & Permissions → Reinstall to Workspace** so the existing `SLACK_BOT_TOKEN` picks up new permissions.
3. Open `/admin/slack` → **Refresh Slack names** (or load Activity — missing names resolve on demand from cache).

### How names are resolved

- Server-side only (`src/lib/slack/profiles.ts`). Tokens never go to the browser.
- Users: `users.info` → prefer `profile.display_name`, then `profile.real_name` / `user.real_name`, then `user.name`, then `Slack user <ID>`.
- Channels: `conversations.info` → `#name` for public channels; DMs always show **Direct Message**.
- Results are cached in Supabase (`slack_user_profiles`, `slack_channel_profiles`, migration **019**). Historical conversations reuse IDs already stored on messages — no new chats required for names to appear once metadata resolves.
- Unresolved private channels fall back to `Channel <ID>` or **Private channel** without failing the admin page.

### 👀 processing reaction

When Baxter accepts an actionable DM or `@Baxter` message:

1. Add 👀 (`reactions.add`, name `eyes`) on the **user’s triggering message** (`event.ts`).
2. Run the existing Baxter answer pipeline / short empty-mention reply.
3. Remove 👀 (`reactions.remove`) after the reply is posted (success or employee-facing error).

Reaction failures are logged and **never** fail the AI job, create duplicate answers, or corrupt conversation state. Bot messages never receive reactions. Reaction events are ignored by the Q&A pipeline.

**Manual step:** add `reactions:write`, then **Reinstall to Workspace**.

---

## 7b. Admin navigation

Slack Activity is **not** a top-level nav item. Admins open:

**Integrations** → `/admin/connectors` → **Slack activity** → `/admin/slack`

The route `/admin/slack` remains available.

## 8. Event subscriptions

1. Open **Event Subscriptions** in the Slack app settings.
2. Turn **Enable Events** on.
3. Set **Request URL** to:

   ```
   https://acton-baxter.vercel.app/api/slack/events
   ```

4. Wait for Slack to verify the URL (green checkmark). Baxter responds to `url_verification` when `SLACK_SIGNING_SECRET` is configured.

### Subscribed bot events

| Event              | Behavior                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `app_mention`      | `@Baxter` in an allowed channel → reply **in a thread**           |
| `message.im`       | DM to Baxter → reply in the DM                                    |
| `reaction_added`   | 👍/👎 on a Baxter Q&A reply → feedback (also monitoring findings) |
| `reaction_removed` | Removing 👍/👎 clears that user’s feedback row for that answer    |

> After adding `reaction_added` / `reaction_removed` under **Event Subscriptions → Subscribe to bot events**, save the page. Slack may ask you to reinstall the app for the new event subscription (scopes `reactions:read` / `reactions:write` are already granted on the live app — this reinstall is for events, not new OAuth scopes).

### How interactions work

| Context     | First message        | Follow-ups                                  |
| ----------- | -------------------- | ------------------------------------------- |
| **DM**      | Free-form text       | Free-form — no `@Baxter` required           |
| **Channel** | `@Baxter <question>` | **Must `@Baxter` again** for each follow-up |

### Retries and deduplication

Slack retries failed deliveries. Baxter deduplicates via `slack_event_receipts` (migration 009): each `event_id` is processed once; duplicates return HTTP 200 with `duplicate: true`.

---

## 9. Slash commands

Configured in the manifest (`docs/slack-app-manifest.yaml`):

| Command        | Request URL                                                      | Usage hint        | Description               |
| -------------- | ---------------------------------------------------------------- | ----------------- | ------------------------- |
| `/property`    | `https://acton-baxter.vercel.app/api/slack/commands/property`    | `[address]`       | Property Research         |
| `/clear`       | `https://acton-baxter.vercel.app/api/slack/commands/clear`       | _(none)_          | Reset Baxter conversation |
| `/help`        | `https://acton-baxter.vercel.app/api/slack/commands/help`        | _(none)_          | Capabilities and examples |
| `/recall`      | `https://acton-baxter.vercel.app/api/slack/commands/recall`      | `[query]`         | Live Slack history search |
| `/pem`         | `https://acton-baxter.vercel.app/api/slack/commands/pem`         | _(none)_          | Open Baxter PEM NEAT tool |
| `/new-project` | `https://acton-baxter.vercel.app/api/slack/commands/new-project` | `[customer name]` | New project setup modal   |

### `/property`

Example: `/property 655 13th St, San Jose, CA`

Baxter acknowledges immediately, runs Property Research asynchronously, and posts a login-protected report link when complete. Slack never receives a PDF attachment.

Report ownership: set `SLACK_REPORT_USER_ID` to an existing employee profile UUID, **or** leave unset and Baxter uses the **first admin profile**. No fake Supabase user is needed for Q&A.

### `/clear` / `/help` / `/recall`

- `/clear` — same reset as plain-text `/clear` in a DM.
- `/help` — static capability text (no OpenAI).
- `/recall <query>` — routes through the shared live Slack retrieval pipeline with recall forced as primary intent. Empty query returns usage examples.

### `/pem` (web handoff)

Full Partnership Evaluation Meeting transcripts are typically far longer than Slack modal input limits (~3000 characters for `plain_text_input`). Baxter does **not** accept PEM transcripts in Slack.

1. `/pem` returns an ephemeral message explaining that generation happens in the Baxter web app.
2. Primary button: **Open PEM NEAT Tool** → `https://acton-baxter.vercel.app/pem-neats/new`
3. Secondary button: **View Existing PEM NEATs** → `https://acton-baxter.vercel.app/pem-neats`
4. **Slack Search OAuth is not required for `/pem`.** No Baxter user mapping is required for the handoff itself (web login applies when opening the tool).
5. Interactivity is **not** required for `/pem` (no modal).

### `/new-project`

Example: `/new-project Lisa Wright`

1. Opens a modal (uses `trigger_id` within Slack’s 3s window). Customer name is prefilled when provided.
2. Search → pick up to 5 GHL matches → confirm (sales rep, next project number, folder/charter/channel names, invite list respecting test mode).
3. Final submit starts a **live** setup (`trigger_channel: slack`), DMs the initiator a run link, and DMs outcome on completion/failure.
4. Requires Interactivity request URL `https://acton-baxter.vercel.app/api/slack/interactions`.
5. Restricted by `SLACK_ALLOWED_USER_IDS` when that allowlist is set.

### Verify slash auth matrix

| Command   | Slack Search OAuth | Needs Baxter user match |
| --------- | ------------------ | ----------------------- |
| `/help`   | No                 | No                      |
| `/clear`  | No                 | No                      |
| `/pem`    | No                 | No (web handoff)        |
| `/recall` | For private/DM     | No (uses Slack user id) |

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

Also run migration **010** for web feedback and **033** for Slack reaction feedback:

```
supabase/migrations/010_baxter_feedback.sql
supabase/migrations/033_baxter_slack_feedback.sql
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
