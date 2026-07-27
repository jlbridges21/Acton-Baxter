# Baxter production checklist

Use this checklist before expanding Baxter beyond a private pilot. Admins can also review live status at **`/admin/baxter/launch-readiness`**.

Production URL: **`https://acton-baxter.vercel.app`**

---

## Database (migrations 001–012)

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
- [ ] `011_google_knowledge_manager.sql` — Google selections / synced files / sync runs
- [ ] `012_knowledge_uploads.sql` — uploads table, `knowledge-uploads` bucket, citation FK SET NULL

Additional database tasks:

- [ ] Create Storage bucket `branding-assets` if migration 004 cannot insert it (private, ≤ 2 MB, PNG/JPEG/WEBP)
- [ ] Confirm Storage bucket `knowledge-uploads` exists (private; created by migration 012)
- [ ] Confirm RLS on reports, branding, jobs, logs, knowledge, Baxter conversations, Slack receipts, feedback, uploads
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

- [ ] `GOOGLE_AUTH_MODE=workspace_oauth`
- [ ] `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` set
- [ ] Redirect URI exact match: `https://acton-baxter.vercel.app/api/admin/connectors/google/oauth/callback`
- [ ] `GOOGLE_TOKEN_ENCRYPTION_KEY` set (server-only; `openssl rand -base64 32`)
- [ ] `GOOGLE_OAUTH_ALLOWED_DOMAINS=actonadu.com` and allowlisted emails
- [ ] Apply migration **013** (`google_connections`, `google_oauth_states`)
- [ ] Drive, Docs, and Sheets APIs enabled (Library search — Google Enterprise API)
- [ ] Admin connected as `baxter@actonadu.com` via **Connect Google Workspace**
- [ ] Shared Drive listed without relying on external service-account membership
- [ ] Optional SA vars only if intentionally using `service_account` mode
- [ ] Apply migration **011** (`google_source_selections`, `google_synced_files`, `google_sync_runs`) if not already
- [ ] Select at least one file or managed folder in the Drive browser (do not rely on “see everything”)
- [ ] **Preview** a Google Doc before first import
- [ ] `GOOGLE_SYNC_ENABLED=true` (default) — controls scheduled sync only
- [ ] `GOOGLE_SYNC_INTERVAL_MINUTES=180` (due logic; Hobby cron may still be daily)
- [ ] `CRON_SECRET` set in Vercel (canonical); optional legacy `INTERNAL_CRON_SECRET`
- [ ] Confirm opening `/api/internal/process-jobs` in a browser returns auth error (expected)
- [ ] **Sync changes** from admin UI starts a sync without entering a cron secret
- [ ] Drive browser opens automatically when OAuth + Shared Drive root already exist
- [ ] **Add selected to Baxter** creates Knowledge entries (including XLSX) without a separate sync step
- [ ] Google entries can be removed from Knowledge Center (**Remove from Baxter**)
- [ ] Migration `016_knowledge_units.sql` applied
- [ ] Migration `017_hybrid_retrieval_and_evals.sql` applied
- [ ] Migration `018_conversation_reset_and_eval_indexes.sql` applied
- [ ] Re-sync Sales Performance Report (or affected Sheets) then **Rebuild Baxter index**
- [ ] Ask Baxter: “How much was the Lori Harris project agreement for?” → `$352,933`
- [ ] Follow-up: “When did she close?” → March 27, 2025
- [ ] Then: “How much have we sold this year?” → current-year total (not Lori’s amount)
- [ ] `/clear` then “What was the margin?” → asks which project
- [ ] Knowledge Center shows spreadsheet / image / PDF / presentation viewers
- [ ] `/admin/baxter/evaluations` golden suite runnable
- [ ] **Sync changes** completes; approved Google-managed entries appear in Knowledge Base
- [ ] Advanced diagnostics (optional): dry-run / repair Google knowledge
- [ ] Scheduled sync: Vercel Cron registered for `/api/internal/process-jobs` (Production only)

---

## Slack

- [ ] Slack app **Baxter** created from `docs/slack-app-manifest.yaml`
- [ ] Events URL verified: `https://acton-baxter.vercel.app/api/slack/events`
- [ ] `/property` URL: `https://acton-baxter.vercel.app/api/slack/commands/property`
- [ ] Bot scopes **only**: `app_mentions:read`, `chat:write`, `im:history`, `commands`, `users:read`, `channels:read`
- [ ] Bot events **only**: `app_mention`, `message.im`
- [ ] Socket Mode **disabled** — `SLACK_APP_TOKEN` unused
- [ ] App installed to Acton workspace; `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in Vercel
- [ ] Migration **019** applied (`slack_user_profiles`, `slack_channel_profiles`)
- [ ] After scope change: **reinstall** Slack app, then `/admin/slack` → Refresh Slack names
- [ ] `/admin/slack` shows Activity first with human display names (not raw `U…` IDs)
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

## Knowledge Base admin

- [ ] `/admin/knowledge` landing shows Add / Upload / Google Drive actions
- [ ] New entry requires only title + content; Approve and publish works
- [ ] Upload Markdown preview + import works
- [ ] Scanned/empty PDF shows no-OCR warning
- [ ] Delete unused manual entry succeeds; cited entry prompts archive
- [ ] Google-managed delete is blocked with Manage source guidance
- [ ] Navigation shows Knowledge, Upload Documents, Google Drive for admins only

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
- [ ] `CRON_SECRET` set (preferred); `INTERNAL_CRON_SECRET` optional legacy alias
- [ ] Vercel cron authorized on `/api/internal/process-jobs` with Bearer header only
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
- [ ] GoHighLevel (when enabled): apply migrations **020** + **021**; set PIT env (`ENABLE_GHL_INTEGRATION`, `GHL_AUTH_MODE=private_integration`, `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`) — **no** OAuth client ID/secret required for PIT
- [ ] Admin → Connectors → GoHighLevel → **Test connection** shows **Connected** when core CRM works (missing `locations.readonly` alone must not force Connected Limited)
- [ ] Contacts browse works (no 422); Opportunities/Conversations show names not raw IDs; Actions shows audit rows
- [ ] Spot-check live CRM ask + one confirmed write from an admin; verify audit on Actions tab
- [ ] **Not in this version:** Buildertrend, Domo, autonomous GHL monitoring; message send / calendar book from Baxter
