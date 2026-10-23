# Setup, credentials, and deployment

## 2. JobTread API setup

- API: JobTread **Pave** — a single endpoint, `POST https://api.jobtread.com/pave`, with a
  JSON query tree. Reference: <https://app.jobtread.com/docs>.
- Authentication: a **grant key** passed inside the query as `{"query": {"$": {"grantKey": "…"}}}`.
  Create grants in JobTread under **Settings → API** (only JobTread admins can).
- Organization: Acton ADU = `22PfjMkZrDjJ` (the default in `src/lib/jobtread/client.ts`;
  override with `JOBTREAD_ORGANIZATION_ID`).
- Grants **expire after 3 months without use**. The Data settings page shows the expiry date
  and warns within 21 days; scheduled syncs keep it in use.
- Queries used (all reads): `currentGrant`, `organization { customFields, jobs, costGroups }`,
  and `job(id) { tasks, files }`. See `src/lib/jobtread/*.ts`.

Verify a grant without the app (do **not** paste the key into chat, tickets, or git):

```bash
curl -s https://api.jobtread.com/pave -H 'Content-Type: application/json' \
  -d "{\"query\":{\"\$\":{\"grantKey\":\"$JOBTREAD_GRANT_KEY\"},\"currentGrant\":{\"name\":{},\"expiresAt\":{}}}}"
```

## 3. Authentication and credential management

| Variable                   | Where       | Notes                                                  |
| -------------------------- | ----------- | ------------------------------------------------------ |
| `JOBTREAD_GRANT_KEY`       | server only | Required. Never prefix with `NEXT_PUBLIC_`.            |
| `JOBTREAD_ORGANIZATION_ID` | server only | Optional; defaults to `22PfjMkZrDjJ`.                  |
| `JOBTREAD_SYNC_ENABLED`    | server only | `true` turns on scheduled syncs (opt-in; default off). |

Guarantees in code:

- The key is read only in `getJobTreadConfig()` (server-only module) and placed only in the
  request body. Error messages strip it (`[redacted]`); it is never logged, stored in the
  database, returned by an API route, sent to the browser, or included in agent prompts.
  Tests assert this (`tests/unit/jobtread-integration.test.ts`, `reports-dexter.test.ts`).
- **Read-only enforcement:** `assertReadOnlyQuery()` rejects any query containing a
  mutation-style field (`create*`, `update*`, `delete*`, `send*`, `copy*`, `cancel*`, `sign*`,
  `upload*`, …, including aliased `_` targets) before any network call.
- The current grant ("Baxter", expires 2027-01-20) has **no action restrictions** in JobTread.
  The code guard makes Baxter read-only regardless, but the safer setup is a grant limited
  to read access — **recommended** before production use. Rotate by creating a new grant,
  updating `JOBTREAD_GRANT_KEY` in Vercel, redeploying, testing the connection, then deleting
  the old grant in JobTread.
- E2E runs (`playwright.config.ts`) override the key with a fake value and read the synthetic
  fixture (`src/lib/jobtread/fixture.ts`), so tests never call JobTread even if `.env.local`
  holds a real key. The fixture can't activate in production.

## 17. Deployment guide

Nothing here has been deployed. Do these in order when you're ready:

1. **Supabase:** apply `supabase/migrations/068_jobtread_reports.sql` (adds the `jt_*` cache
   tables, `bi_reports`, `bi_report_revisions`, `bi_report_shares`, `bi_report_views`, `bi_report_pins`,
   `bi_report_chat_messages`, `bi_report_executions`; extends the agent access-level check with
   `customer_data` / `financial_data`; adds the `jobtread_sync` job type). All tables have
   RLS enabled with no browser policies — access is only through server routes with the
   service role. The migration is additive.
2. **Vercel (Production + Preview):** set `JOBTREAD_GRANT_KEY` (sensitive), optionally
   `JOBTREAD_ORGANIZATION_ID`, and `JOBTREAD_SYNC_ENABLED=true` when you want scheduled syncs.
3. **Deploy**, then as an admin open **Reports → Data settings**:
   - **Test connection** → expect "Connected · Acton ADU".
   - **Sync now** → expect ~447 jobs and ~79 catalog groups.
   - Review **Business fields** (5 terms have no JobTread field — see limitations) and the
     **access category** of each field.
4. Dexter and the Business Intelligence & Analytics department are created automatically on
   first load of the AI Workspace (seed). Baxter's delegation guidelines are upgraded to
   mention Dexter only if they still equal the shipped default; customized guidelines are
   left alone (add a Dexter line yourself in AI Studio).
5. Grant access on **AI Workspace → Agents → Dexter → Access**: by default every `user` can
   use Reports and chat with Dexter (project information only). Add **Customer details
   (Reports)** and **Financial figures (Reports)** for the people who need them.

### Scheduled sync, cron, and cost

- The existing Vercel cron (`vercel.json`, `/api/internal/process-jobs` every 2 minutes)
  checks whether the sync interval (default 60 min, adjustable in Data settings) has elapsed
  and enqueues a `jobtread_sync` job on the existing durable job queue. No new cron or worker.
- Cost: one full sync ≈ 22 Pave requests and ~3 s of function time (measured 2026-10-22).
  Hourly ≈ 530 requests/day. Project pages add 1 request per project view (5-min cache).
  Dexter runs on Claude Opus 5.5 (budget per request: ≤300k tokens / $2, configurable) —
  monitor in **AI Workspace → Mission Control** (tasks, tokens, cost per agent).
- Usage telemetry: `bi_report_executions` (views, drilldowns, exports, durations) and
  `jt_sync_runs` (requests, records, duration, errors).

### Rollback

- **Turn off quickly:** unset `JOBTREAD_SYNC_ENABLED` (stops syncs); pause Dexter in AI Studio
  (Baxter stops delegating to him; Reports still render from the cache); or remove
  `JOBTREAD_GRANT_KEY` (all JobTread calls stop; reports show "not connected").
- **Code rollback:** redeploy the previous Vercel deployment. Migration 068 is additive and
  can stay in place; `/reports` would revert to the old Property Research list.
- **Data rollback:** report history is never rewritten — restore any version from
  **History**. Cache tables can be emptied safely; the next sync rebuilds them.
