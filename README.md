# Baxter

Baxter is Acton ADU’s internal digital teammate (runtime v1.1). See `docs/baxter/governance-architecture.md`.

**Property Research** is the first Baxter tool. It researches a California property address and prepares a short Partnership Evaluation Meeting (PEM) brief.

Baxter also answers employees in Slack (DMs, `@Baxter` mentions, and `/property`). See **Prompt 5B** setup in `docs/slack-setup.md`.

**Supported automated jurisdictions today (Property Research)**

- City of San Jose GIS (parcel, zoning, general plan, historic where available)
- Santa Clara County GIS (parcel profile attributes and Property Explorer link)

Outside those sources, Property Research still uses ATTOM and RentCast when configured, and shows official manual-review links. It never declares ADU feasibility.

---

## What Property Research does

1. Salesperson signs in to Baxter.
2. Opens **Property Research Tool** from the Baxter Dashboard (or goes to `/reports/new`).
3. Selects a standardized property address (Google Places autocomplete when configured).
4. App researches licensed + public sources, detects meaningful conflicts, and prepares a concise report.
5. Optional Slack `/property` command creates the same report and returns a login-protected link.
6. Salesperson opens the report and uses **Download / Print PDF**.

Reports target **under six printed pages**.

---

## Local setup (copy/paste)

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` with Supabase values at minimum:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
APP_BASE_URL=http://localhost:3000
ENABLE_MOCK_RESEARCH=true
AI_PROVIDER=deterministic
```

```bash
npm run dev
```

Open http://localhost:3000 — authenticated users land on the **Baxter Dashboard**.

---

## Knowledge Base (admin)

Admins can manage institutional knowledge at `/admin/knowledge`.

- Draft → Approve → (edit returns to draft) → Approve again
- Archived entries and drafts are never used for Baxter employee answers
- See `docs/baxter-knowledge-base.md` and `docs/baxter-roadmap.md`

Run migration `006_knowledge_base.sql` in Supabase before using Knowledge Base against a live database.

## Baxter web chat

Authenticated employees see **Ask Baxter** on the Baxter Dashboard (`/`) only.

- Answers identity and general questions even when the Knowledge Base is empty
- Uses approved Acton Knowledge Base / Google-synced entries for company-specific facts
- Cites real sources (model cannot invent URLs); PDF/slide citations include page/slide when indexed
- `/clear` or **New chat** starts a fresh conversation; `/help` lists commands
- Temporal sales questions (e.g. “How much have we sold this year?”) aggregate from the Sales Performance Report in code
- Thumbs up/down feedback on assistant messages
- Admin diagnostics: `/admin/baxter/diagnostics` (retrieval inspector + knowledge health)
- Evaluations: `/admin/baxter/evaluations`
- Launch readiness: `/admin/baxter/launch-readiness`
- Feedback review: `/admin/baxter/feedback`
- Employee guide: `docs/baxter-employee-guide.md`
- Troubleshooting: `docs/baxter-troubleshooting.md`

## Connectors (Google Workspace, GoHighLevel, Slack)

- Admin top nav **Integrations** → `/admin/connectors` (Google Workspace, GoHighLevel, Slack, future connectors)
- Google Workspace OAuth + Drive Knowledge Manager: `/admin/connectors/google` — see `docs/google-workspace-oauth-setup.md` and `docs/google-connector.md`
  - Prefer connecting as `baxter@actonadu.com` (service account is often blocked from Acton Shared Drives)
  - Scheduled sync: `GOOGLE_SYNC_ENABLED`, `GOOGLE_SYNC_INTERVAL_MINUTES` (default 180)
- GoHighLevel CRM connector: `/admin/connectors/ghl` — see `docs/gohighlevel-connector.md`
  - Read-only Prompt 1: contacts, opportunities, pipelines, calendars, conversations, users
  - Primary auth: Private Integration Token (env var)
  - Customer data NOT synced to Knowledge Base (read on-demand)
- Knowledge Center still links directly to Google Workspace and Upload Files where useful
- Slack Baxter Q&A (Prompt 5B): DMs, `@Baxter` mentions, threads — see `docs/slack-setup.md` and `docs/slack-bot.md`
- Slack `/property` command: Property Research from Slack
- Slack admin Activity (human names): `/admin/slack` — apply migration **019**, add `users:read` + `channels:read`, reinstall Slack app, then **Refresh Slack names**
- Connector overview: `/admin/connectors`

---

## Supabase migrations (run in order)

In Supabase SQL Editor, run each file completely:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_live_research_metadata.sql`
3. `supabase/migrations/003_prompt3_production.sql`
4. `supabase/migrations/004_branding_storage.sql`
5. `supabase/migrations/005_new_user_role_and_maps.sql`
6. `supabase/migrations/006_knowledge_base.sql`
7. `supabase/migrations/007_baxter_conversations.sql`
8. `supabase/migrations/008_google_sync_and_slack_events.sql`
9. `supabase/migrations/009_slack_production.sql`
10. `supabase/migrations/010_baxter_feedback.sql`
11. `supabase/migrations/011_google_knowledge_manager.sql` (if present in your tree)
12. `supabase/migrations/012_knowledge_uploads.sql`
13. `supabase/migrations/013_google_workspace_oauth.sql`
14. `supabase/migrations/014_admin_role_management.sql`
15. `supabase/migrations/015_google_knowledge_usability.sql`
16. `supabase/migrations/016_knowledge_units.sql`
17. `supabase/migrations/017_hybrid_retrieval_and_evals.sql`
18. `supabase/migrations/018_conversation_reset_and_eval_indexes.sql`
19. `supabase/migrations/019_slack_display_profiles.sql`

Also create Storage bucket `branding-assets` if step 4 cannot insert into `storage.buckets` in your project (Dashboard → Storage → New bucket → private → 2 MB → PNG/JPEG/WEBP).

---

## Create users and first admin

Users can **create an account from the login screen**. New self-registered accounts receive the `new_user` role and are blocked from research until an admin grants access.

### Option A — self signup (recommended)

1. Open `/login` → **Create account**
2. After signup/sign-in, the user lands on **Access pending**
3. An admin opens **Admin → Users** and clicks **Grant salesperson** (or admin)

### Option B — Supabase dashboard

1. Supabase → Authentication → Users → Add user
2. Confirm profile row in `profiles`
3. Promote admin (or salesperson):

```sql
update public.profiles
set role = 'admin'
where id = '<user-uuid>';
```

Roles: `new_user` (pending), `salesperson` (app access), `admin` (app + admin tools).
---

## Live research keys

```bash
ENABLE_MOCK_RESEARCH=false
ALLOW_MOCK_FALLBACK=false
ATTOM_API_KEY=...
RENTCAST_API_KEY=...
```

Test at `/admin/provider-test` (admin, non-production).

---

## Google Maps / Places (recommended)

1. Google Cloud Console → enable **Places API**, **Geocoding API**, **Maps Static API**, and **Street View Static API**
2. Create:
   - Browser key → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (HTTP referrer restricted to your domains)
   - Server key → `GOOGLE_MAPS_SERVER_API_KEY` (IP / server restricted; Places, Geocoding, Maps Static, Street View Static)
3. Restart the app

Reports use Google for address autocomplete plus satellite / Street View imagery (proxied through `/api/reports/[id]/imagery`) and deep links to Google Maps.

Without Google keys, manual address entry still works in mock mode; live mode should use autocomplete/resolve for confidence.

---

## AI setup

**Property Research** (report narrative) uses `AI_PROVIDER` (default `deterministic`). Optional alias: `PROPERTY_RESEARCH_AI_PROVIDER`.

**Baxter chat** uses separate variables — see `docs/baxter-ai-providers.md`:

```bash
AI_PROVIDER=deterministic   # Property Research only; default, no key required
BAXTER_LLM_PROVIDER=openai
BAXTER_LLM_FALLBACK_PROVIDER=   # optional: anthropic
BAXTER_OPENAI_MODEL=gpt-4o-mini
BAXTER_ANTHROPIC_MODEL=claude-3-5-haiku-latest
BAXTER_EMBEDDING_PROVIDER=openai
BAXTER_EMBEDDING_MODEL=text-embedding-3-small
BAXTER_VISION_PROVIDER=openai
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

If Property Research AI fails, the report still completes with deterministic PEM content.

---

## Branding / logo

1. Sign in as admin
2. Open `/admin/branding`
3. Upload PNG/JPEG/WEBP ≤ 2 MB
4. Logo appears in nav, login, and report/print header

---

## Slack (Prompt 5B — production)

Full setup: [docs/slack-setup.md](docs/slack-setup.md) · Architecture: [docs/slack-bot.md](docs/slack-bot.md) · Manifest: [docs/slack-app-manifest.yaml](docs/slack-app-manifest.yaml)

Baxter in Slack reuses the same `answerBaxterQuestion()` backend as web chat. Production URL: `https://acton-baxter.vercel.app`

```bash
ENABLE_SLACK_INTEGRATION=true
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_ALLOWED_TEAM_IDS=T...
SLACK_ALLOWED_CHANNEL_IDS=          # empty = channel mentions disabled (safe pilot default)
SLACK_ENABLE_DMS=true
SLACK_ENABLE_CHANNEL_MENTIONS=true
# SLACK_REPORT_USER_ID=<uuid>       # optional — /property report ownership only; else first admin
NEXT_PUBLIC_APP_URL=https://acton-baxter.vercel.app
BAXTER_OPENAI_FALLBACK_MODEL=       # optional — temporary rate-limit fallback
GOOGLE_SYNC_ENABLED=true
GOOGLE_SYNC_INTERVAL_MINUTES=180
CRON_SECRET=<long-random>
# INTERNAL_CRON_SECRET=   # deprecated alias if CRON_SECRET unset
```

- **Q&A:** DM Baxter or `@Baxter` in an allowed channel (replies in thread)
- **Property Research:** `/property 655 13th St, San Jose, CA`
- **Admin:** `/admin/slack`
- **Google Knowledge Manager:** `/admin/connectors/google` (see `docs/google-drive-knowledge-manager.md`)

Slack never uploads PDFs. Property Research posts a login-protected report link only.

---

## Vercel deploy

1. Import GitHub repo
2. Add environment variables (see `.env.example`)
3. Set `APP_BASE_URL` to the Vercel URL
4. Set `ENABLE_MOCK_RESEARCH=false` only after live keys work
5. Set `ALLOW_MOCK_FALLBACK=false`
6. Deploy
7. Point Slack slash command Request URL to `https://YOUR_APP/api/slack/commands/property`
8. Confirm Vercel Cron hits `/api/internal/process-jobs` with `Authorization: Bearer ${CRON_SECRET}` (browser open will 401 — expected)
9. Apply Supabase migration **011** for Google Knowledge Manager tables
10. Use admin **Run sync now** for manual Google sync (no cron secret)

---

## Tests

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Paid live integration (optional):

```bash
RUN_LIVE_INTEGRATION_TESTS=true npm run test:integration
```

---

## Employee URL paths

| Who      | Path                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Everyone | `/login`, `/dashboard`, `/reports/new`, `/reports/[id]`                                                           |
| Admin    | `/admin/knowledge`, `/admin/users`, `/admin/branding`, `/admin/baxter/launch-readiness`, `/admin/baxter/feedback` |

---

## More docs

- [docs/architecture.md](docs/architecture.md)
- [docs/source-priority.md](docs/source-priority.md)
- [docs/report-limitations.md](docs/report-limitations.md)
- [docs/adding-jurisdictions.md](docs/adding-jurisdictions.md)
- [docs/slack-setup.md](docs/slack-setup.md)
- [docs/baxter-employee-guide.md](docs/baxter-employee-guide.md)
- [docs/production-checklist.md](docs/production-checklist.md)
- [docs/baxter-troubleshooting.md](docs/baxter-troubleshooting.md)
- [docs/baxter-roadmap.md](docs/baxter-roadmap.md)

---

## Important limitations

- Not a feasibility study, survey, title report, or zoning determination
- Santa Clara County Property Profile is currently **generic_search** (search by APN)
- Flood/fire values are manual-review links unless a reliable automated source is connected later
- Imagery-based yard measurements are not included
- No GoHighLevel / Buildertrend / internal Acton project search in this version
