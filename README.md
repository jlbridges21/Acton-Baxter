# Acton Property Research

Internal Acton ADU app for researching a California property address and preparing a short Partnership Evaluation Meeting (PEM) brief.

**Supported automated jurisdictions today**

- City of San Jose GIS (parcel, zoning, general plan, historic where available)
- Santa Clara County GIS (parcel profile attributes and Property Explorer link)

Outside those sources, the app still uses ATTOM and RentCast when configured, and shows official manual-review links. It never declares ADU feasibility.

---

## What the app does

1. Salesperson signs in.
2. Selects a standardized property address (Google Places autocomplete when configured).
3. App researches licensed + public sources, detects meaningful conflicts, and prepares a concise report.
4. Optional Slack `/property` command creates the same report and returns a login-protected link.
5. Salesperson opens the report and uses **Download / Print PDF**.

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

Open http://localhost:3000

---

## Supabase migrations (run in order)

In Supabase SQL Editor, run each file completely:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_live_research_metadata.sql`
3. `supabase/migrations/003_prompt3_production.sql`
4. `supabase/migrations/004_branding_storage.sql`

Also create Storage bucket `branding-assets` if step 4 cannot insert into `storage.buckets` in your project (Dashboard → Storage → New bucket → private → 2 MB → PNG/JPEG/WEBP).

---

## Create users and first admin

1. Supabase → Authentication → Users → Add user
2. Confirm profile row in `profiles`
3. Promote admin:

```sql
update public.profiles
set role = 'admin'
where id = '<user-uuid>';
```

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

1. Google Cloud Console → enable **Places API** and **Geocoding API**
2. Create:
   - Browser key → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (HTTP referrer restricted to your domains; Places only)
   - Server key → `GOOGLE_MAPS_SERVER_API_KEY` (IP / server restricted; Places + Geocoding)
3. Restart the app

Without Google keys, manual address entry still works in mock mode; live mode should use autocomplete/resolve for confidence.

---

## AI setup

```bash
AI_PROVIDER=deterministic   # default, no key required
# or
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
# or
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-3-5-haiku-latest
```

If AI fails, the report still completes with deterministic PEM content.

---

## Branding / logo

1. Sign in as admin
2. Open `/admin/branding`
3. Upload PNG/JPEG/WEBP ≤ 2 MB
4. Logo appears in nav, login, and report/print header

---

## Slack

See [docs/slack-setup.md](docs/slack-setup.md).

```bash
ENABLE_SLACK_INTEGRATION=true
SLACK_SIGNING_SECRET=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_ALLOWED_TEAM_IDS=T...
SLACK_REPORT_USER_ID=<acton-profile-uuid>
INTERNAL_CRON_SECRET=<long-random>
```

Slash command: `/property 655 13th St, San Jose, CA`

Slack never uploads PDFs. It only posts a protected report link.

---

## Vercel deploy

1. Import GitHub repo
2. Add environment variables (see `.env.example`)
3. Set `APP_BASE_URL` to the Vercel URL
4. Set `ENABLE_MOCK_RESEARCH=false` only after live keys work
5. Set `ALLOW_MOCK_FALLBACK=false`
6. Deploy
7. Point Slack slash command Request URL to `https://YOUR_APP/api/slack/commands/property`
8. Confirm cron hits `/api/internal/process-jobs` with Bearer `INTERNAL_CRON_SECRET`

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

| Who      | Path                                                                |
| -------- | ------------------------------------------------------------------- |
| Everyone | `/login`, `/dashboard`, `/reports`, `/reports/new`, `/reports/[id]` |
| Admin    | `/admin/sources`, `/admin/provider-test`, `/admin/branding`         |

---

## More docs

- [docs/architecture.md](docs/architecture.md)
- [docs/source-priority.md](docs/source-priority.md)
- [docs/report-limitations.md](docs/report-limitations.md)
- [docs/adding-jurisdictions.md](docs/adding-jurisdictions.md)
- [docs/slack-setup.md](docs/slack-setup.md)
- [docs/production-checklist.md](docs/production-checklist.md)

---

## Important limitations

- Not a feasibility study, survey, title report, or zoning determination
- Santa Clara County Property Profile is currently **generic_search** (search by APN)
- Flood/fire values are manual-review links unless a reliable automated source is connected later
- Imagery-based yard measurements are not included
- No GoHighLevel / Buildertrend / internal Acton project search in this version
