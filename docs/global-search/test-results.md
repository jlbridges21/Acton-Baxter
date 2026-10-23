# Test results

Run on 2026-10-23 on the developer's machine. All data is synthetic: the JobTread fixture
plus generated agents, reports, knowledge, inventory, contacts, and employees. CRM and HR
connectors are mocked at the module boundary.

## Commands

```bash
npm run format && npm run lint && npm run typecheck && npm run test && npm run build
```

| Step      | Result                                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format    | clean                                                                                                                                                                                                                                                                                           |
| lint      | 0 errors (6 warnings, all in pre-existing files)                                                                                                                                                                                                                                                |
| typecheck | clean                                                                                                                                                                                                                                                                                           |
| test      | **2,324 passed, 45 failed, 1 skipped**. The 45 failures are the known baseline: localStorage is unavailable in jsdom, in `dashboard-tools-view`, `dashboard-tools`, `inventory-ui`, `project-status-filter`, `site-inspection-response-race`, and `site-inspection-runner-ui`. No new failures. |
| build     | succeeds (`/admin/search`, `/api/search`, `/api/search/home`, `/api/search/track`, `/api/admin/search` all built)                                                                                                                                                                               |

## Global Search suites (72 tests, all passing)

| File                                         | Tests | Covers                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/global-search-core.test.ts`      | 17    | Normalization (text, identifiers, phones, addresses: suffixes, directionals, units, ZIP+4); tier order; exact identifiers; email and phone; partial addresses; typos; numbers never fuzzy-match; boosts can't outrank tiers; synonyms capped; highlighting; URL allow-list; snippet sanitizing; section ordering; counts; freshness labels                        |
| `tests/unit/global-search-providers.test.ts` | 32    | Every provider, plus security and reliability (below)                                                                                                                                                                                                                                                                                                             |
| `tests/unit/global-search-ui.test.tsx`       | 17    | Button position and tooltip (⌘K on Mac, Ctrl+K elsewhere), shortcut rules, open, close, focus restore, backdrop, responsive classes, empty view, home loaded once (no request loop), debounce, highlight, stale out-of-order responses, pills, Tab cycling, See all, arrows and Enter, tracking, no-results vs unavailable, Ask Baxter hand-off, cached freshness |
| `tests/unit/global-search-routes.test.ts`    | 6     | NDJSON streaming, 400 on oversized queries, rate limit 429, track validation, admin-only 403, restricted fields rejected (400)                                                                                                                                                                                                                                    |

### Provider coverage (`global-search-providers.test.ts`)

- **Tools and settings:** name, alias, and typo search; role-specific URLs; admin pages hidden
  from employees; "BambooHR" shows Sam Operations to employees and BambooHR settings and
  employees pages only to HR; a new registry page is searchable with no code change.
- **Agents:** a published agent has a status and a chat action; a newly created agent
  appears automatically; drafts are hidden from employees.
- **Reports:** a new report is found immediately; another user's private report never
  appears; it appears after it becomes company-visible; a private financial (commissions)
  report's title and count don't leak; a personal group is private.
- **No Reports access:** no Reports or Jobs category at all, on the home view or in
  search.
- **JobTread:** exact name, exact job number (identifier tier), partial address ("3 test
  street"), and mapped model field; cached freshness; JobTread link; customer-only and
  internal field values never match or appear; removed jobs drop out and the reindex counts
  the removal; disconnect purges the index and reports "unavailable".
- **Knowledge:** drafts visible only to the author and admins, with no title leakage;
  bodies are not searchable; archiving hides an entry immediately (before reindex).
- **Inventory:** SKU identifier match; no costs in output; deleted items drop out.
- **Planted index row:** an unauthorized cached row is never returned, even to admins when
  its source record doesn't exist.
- **GoHighLevel:** Customer Center links; copy actions; invalid ids dropped; custom fields
  never shown; address queries use the free-text query; normalized address ranking;
  cross-source address grouping without merging; "unavailable" when disconnected.
- **BambooHR:** invisible to regular employees (the API is never called); HR sees name,
  title, and status; searches are audited; restricted fields can't be enabled.
- **Reliability:** a slow provider times out without blocking others; the fast provider
  streams first; an error message never leaks internals ("password" in the thrown error
  stays out of the response); unsafe URLs and markup are stripped; external rate limit;
  oversized query; too-short query reported as skipped; latency metrics record timeouts.
- **Recents:** stored only for visible records; re-authorized on read; no cross-user
  leakage; a deleted record disappears; categories hide when unavailable or disabled; core
  providers can't be disabled; disabling purges the index; synonyms apply.

## Regression

- `tests/unit/app-nav-links.test.ts` passes unchanged. A one-off parity check during
  development confirmed the registry-derived employee and admin navs are identical to the
  previous hardcoded lists (labels, hrefs, icons, and `match` results over 29 paths).
- `tests/unit/schema-erd.test.ts` used to grep `admin-nav.ts` source for the Schema link. It
  now asserts the link through the derived nav and the registry entry's admin audience.
- Reports, report groups, Dexter, Sam Operations, BambooHR, org routing, Customer Center,
  and JobTread unit suites all pass within the full run.

## End to end (Playwright, port 3100)

`npx playwright test tests/e2e/global-search.spec.ts tests/e2e/reports.spec.ts tests/e2e/ai-workspace.spec.ts tests/e2e/sam-operations.spec.ts`

**24 passed, 1 failed.** The failure is the known, unrelated Reports Data Catalog check
("no records in Acton").

Global Search E2E covers:

- button position and tooltip, the ⌘K/Ctrl+K shortcut, focus, and Escape;
- typo search, highlighting, and Enter navigation;
- JobTread results with "Last synced" freshness, no-results, and Ask Baxter;
- phone layout and employees not seeing admin pages;
- a measured-latency run (see `performance.md`).

Note: the first E2E run inherited live GoHighLevel credentials from `.env.local`, so a few
read-only contact and opportunity searches reached GoHighLevel. That run exposed that
GoHighLevel rejects `address1` filters, which is now fixed. Playwright now sets
`ENABLE_GHL_INTEGRATION=false`. No GoHighLevel, JobTread, or BambooHR records were written
at any point.

Also, during manual browser verification, the existing `baxter-ai-sandbox` launch
configuration (which doesn't override `JOBTREAD_GRANT_KEY`) let the job indexer's first-use
sync, the same `ensureJobTreadData()` path Reports uses, run a read-only JobTread sync
(118 read requests) into that dev server's in-memory store. The server was stopped to
discard it, and verification continued on a new `baxter-search-sandbox` configuration that
pins the synthetic JobTread fixture and turns GoHighLevel off.
