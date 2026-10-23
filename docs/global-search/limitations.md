# Limitations

- **Latency metrics are per instance.** They're held in memory, so each serverless instance
  keeps its own samples, and they reset on deploy. Nothing is extrapolated.
- **Rate limits are in memory** (`src/lib/rate-limit.ts`), so they apply per instance, not
  globally. Move to a shared store (e.g. Redis) if abuse becomes a concern.
- **Index freshness.** New knowledge, inventory, and inspection records become discoverable
  after the next refresh (5–10 min) or a manual reindex. Edits and deletions are reflected
  immediately, because results are re-read from the source. New JobTread jobs need the
  JobTread sync, then the index refresh.
- **JobTread customer-category fields** are matched only after the per-viewer re-read, not
  through the index, so they can't be found by typo through the index path.
- **No Baxter job page exists,** so JobTread results open JobTread (new tab).
- **GoHighLevel address search** relies on GoHighLevel's literal `contains` filter on
  `address1` and `postalCode`, using the house number and first street word. Addresses stored
  very differently in GoHighLevel (e.g. "One Main St") won't match. Opportunities are
  searched by name only. Pipeline and stage names would cost extra API calls per keystroke.
- **BambooHR** filters one name field per request (last name, then first name). Directory
  fields are limited to name, job title, and status. There are no recents for employee
  records (by design).
- **No Baxter page for opportunities** for non-admins: they open the contact's Customer
  Center view.
- **Cmd/Ctrl+number** category shortcuts are best-effort. Some browsers reserve Cmd+1–9 for
  tab switching. Tab and Shift+Tab always cycle categories.
- **Sam Operations workflows, HR documents, contracts, Slack messages, PEM NEATs, and
  property research reports** are not searchable yet. They hold sensitive or per-user data
  that needs its own authorization review before it is added.
- **Fuzzy matching in Supabase** uses `pg_trgm` word similarity (default threshold 0.6) for
  candidates. Very short typos may not produce candidates there even when the TypeScript
  ranker would accept them.
- **The "Pending approval" role** is blocked by `requireActiveUser`, which is not
  exercisable through the test bypass (the bypass only knows `user` and `admin`).
- **First job search can trigger the first JobTread sync.** Like Reports, the job indexer
  calls `ensureJobTreadData()`, so on a server with a real `JOBTREAD_GRANT_KEY` and no sync
  yet, the first job search runs a read-only sync. Use the `baxter-search-sandbox` launch
  configuration (or the Playwright environment) for local testing without live data.
