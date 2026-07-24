# Baxter production checklist

Use this checklist before expanding Baxter beyond a private pilot. Admins can also review live status at **`/admin/baxter/launch-readiness`**.

Production URL: **`https://acton-baxter.vercel.app`**

---

## Database (migrations 001–010)

Run each file in Supabase SQL Editor, in order:

- [ ] `001_initial_schema.sql`
- [ ] `002_live_research_metadata.sql`
- [ ] `003_prompt3_production.sql`
- [ ] `004_branding_storage.sql`
- [ ] `005_new_user_role_and_maps.sql`
- [ ] `006_knowledge_base.sql`
- [ ] `007_baxter_conversations.sql`
- [ ] `008_google_sync_and_slack_events.sql`
- [ ] `009_slack_production.sql` — `slack_event_receipts`, `slack_baxter_reply` job type
- [ ] `010_baxter_feedback.sql` — web chat thumbs feedback

Additional database tasks:

- [ ] Create Storage bucket `branding-assets` if migration 004 cannot insert it (private, ≤ 2 MB, PNG/JPEG/WEBP)
- [ ] Confirm RLS on reports, branding, jobs, logs, knowledge, Baxter conversations, Slack receipts, feedback
- [ ] Create at least one **admin** profile (`profiles.role = 'admin'`)
- [ ] Grant **salesperson** (or admin) to employees who need Property Research
- [ ] Confirm at least one **approved** Knowledge Base entry exists (bootstrap or Google sync)

---

## OpenAI

- [ ] `OPENAI_API_KEY` set in Vercel **Production** (not Preview only)
- [ ] `BAXTER_CHAT_ENABLED=true`
- [ ] `BAXTER_LLM_PROVIDER=openai`
- [ ] `BAXTER_OPENAI_MODEL=gpt-4o-mini` (or chosen primary model)
- [ ] Optional: `BAXTER_OPENAI_FALLBACK_MODEL` for temporary model-specific rate limits
- [ ] OpenAI billing enabled; project budget / usage limits not exhausted
- [ ] Test at `/admin/baxter/diagnostics` — **Test OpenAI**, **Test complete pipeline**
- [ ] Confirm “Who is Baxter?” works on web chat without requiring KB entries
- [ ] Distinguish **quota/billing** errors (`BAXTER_OPENAI_QUOTA_EXCEEDED`, not retryable) from **temporary rate limits** (`BAXTER_OPENAI_RATE_LIMITED`, retryable)
- [ ] Redeploy after changing any OpenAI env vars

---

## Google Workspace connector

- [ ] `GOOGLE_PROJECT_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` set in Vercel
- [ ] Private key normalized (literal `\n` or real newlines; valid `BEGIN`/`END` markers)
- [ ] Drive, Docs, and Sheets APIs enabled in Google Cloud
- [ ] Root folder or sync folders shared with **`GOOGLE_CLIENT_EMAIL`** (service account), not only `baxter@actonadu.com`
- [ ] Shared Drive folders: service account added as Shared Drive member (if applicable)
- [ ] `GOOGLE_DRIVE_ROOT_FOLDER` or admin-added folders configured at `/admin/connectors/google`
- [ ] `GOOGLE_SYNC_ENABLED=true` (default)
- [ ] `GOOGLE_SYNC_INTERVAL_MINUTES=180` (default; min 15, max 1440)
- [ ] **Dry-run sync** passes at `/admin/connectors/google`
- [ ] **Run real sync** completes; approved Google entries appear in Knowledge Base
- [ ] **Test Google source through Baxter** cites a real Google URL
- [ ] Scheduled sync enqueues via Vercel cron (`/api/internal/process-jobs`)

---

## Slack

- [ ] Slack app **Baxter** created from `docs/slack-app-manifest.yaml`
- [ ] Events URL verified: `https://acton-baxter.vercel.app/api/slack/events`
- [ ] `/property` URL: `https://acton-baxter.vercel.app/api/slack/commands/property`
- [ ] Bot scopes **only**: `app_mentions:read`, `chat:write`, `im:history`, `commands`
- [ ] Bot events **only**: `app_mention`, `message.im`
- [ ] Socket Mode **disabled** — `SLACK_APP_TOKEN` unused
- [ ] App installed to Acton workspace; `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in Vercel
- [ ] `ENABLE_SLACK_INTEGRATION=true`
- [ ] `SLACK_ALLOWED_TEAM_IDS` set to Acton workspace team ID
- [ ] Pilot: start with **empty** `SLACK_ALLOWED_CHANNEL_IDS` (DMs only)
- [ ] `SLACK_ENABLE_DMS=true`, `SLACK_ENABLE_CHANNEL_MENTIONS=true`
- [ ] `SLACK_REPORT_USER_ID` **optional** — only for `/property` report ownership; if unset, first admin profile is used. **Do not create a fake Supabase user for Slack Q&A.**
- [ ] Baxter invited to pilot channels (`/invite @Baxter`) before enabling channel IDs
- [ ] Migration **009** applied (`slack_event_receipts` exists)
- [ ] `/admin/slack` health is **ready** (not `misconfigured` or `offline`)
- [ ] DM test: “Who is Baxter?” returns identity answer
- [ ] Channel test: `@Baxter` reply in thread; follow-up requires `@Baxter` again
- [ ] `/property 655 13th St, San Jose, CA` returns login-protected report link (no PDF in Slack)
- [ ] Duplicate Slack events produce only one reply (dedupe via migration 009)
- [ ] Full setup: `docs/slack-setup.md`

---

## Web application

- [ ] `NEXT_PUBLIC_APP_URL=https://acton-baxter.vercel.app` (Knowledge Base source links in Slack and web)
- [ ] `APP_BASE_URL` matches production HTTPS URL
- [ ] Baxter Dashboard chat on `/` works for authenticated employees
- [ ] Thumbs feedback on web chat answers works (`POST /api/baxter/feedback`)
- [ ] Admin feedback review at `/admin/baxter/feedback`
- [ ] Property Research: `/reports/new` with live keys when ready
- [ ] `ENABLE_MOCK_RESEARCH=false` and `ALLOW_MOCK_FALLBACK=false` for live research
- [ ] ATTOM / RentCast tested at `/admin/provider-test` (when using live research)
- [ ] San Jose + Santa Clara GIS paths verified for supported addresses
- [ ] Google Maps / Places keys restricted (browser referrer + server IP)
- [ ] Acton logo uploaded at `/admin/branding`
- [ ] Sample dense report prints ≤ 6 pages
- [ ] `npm run build` passes

---

## Security

- [ ] No secrets committed to git (`.env.local` only locally)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` server-side only
- [ ] `INTERNAL_CRON_SECRET` set; Vercel cron authorized on `/api/internal/process-jobs`
- [ ] Slack signing secret and bot token never pasted into Slack messages
- [ ] `SLACK_ALLOWED_TEAM_IDS` restricts to Acton workspace only
- [ ] No broad Slack scopes (`channels:history`, etc.) without explicit approval
- [ ] App not published to Slack App Directory (internal only)
- [ ] Unauthenticated users cannot open protected reports
- [ ] Admin pages show secrets as Yes/No only, never raw values
- [ ] No API keys in client bundle except intentional `NEXT_PUBLIC_*` values

---

## Launch

- [ ] Review **`/admin/baxter/launch-readiness`** — target **Ready for pilot** or **Ready for employee rollout**
- [ ] Resolve all blockers and attention items on launch readiness page
- [ ] Share **`docs/baxter-employee-guide.md`** with pilot participants
- [ ] Pilot rollout per `docs/slack-setup.md` (DMs → one channel → expand)
- [ ] Monitor `/admin/slack`, `/admin/baxter/diagnostics`, and `/admin/baxter/feedback` during pilot
- [ ] Collect wrong/incomplete answers; improve approved Knowledge Base and Google sync
- [ ] Confirm employees understand **Sources** vs **general guidance** labels
- [ ] **Not in this version:** Buildertrend, GoHighLevel, Domo, embeddings, proactive monitoring
