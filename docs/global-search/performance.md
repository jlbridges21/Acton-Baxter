# Performance

## Design

| Concern        | Implementation                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typing         | 200 ms debounce (`SEARCH_DEBOUNCE_MS`). Results for the previous query stay visible until the new one starts answering, so nothing flickers.                                                                                   |
| Stale requests | Each new query aborts the previous `fetch` (`AbortController`). A sequence number drops any event from an older request that still arrives. The server stops streaming when the client disconnects.                            |
| Concurrency    | All permitted providers start together. The NDJSON stream emits each provider's results the moment it finishes: progressive rendering.                                                                                         |
| Timeouts       | Per provider: registry 1.5 s; agents, tasks, and indexed providers 2.5 s; reports 3 s; GoHighLevel and BambooHR 3.5 s. Permission checks 2 s, availability checks 1.5 s. A timeout ends only that provider (status `timeout`). |
| Isolation      | A provider error or timeout becomes a status line ("BambooHR didn't respond in time…") and never blocks or fails the others.                                                                                                   |
| Query limits   | 120 characters (UI `maxLength` and server validation); minimum 1 to 2 characters per provider.                                                                                                                                 |
| Pagination     | 5 results per section in "All"; 25 per page in a category ("See all"), with "Load more" (`offset`).                                                                                                                            |
| Rate limits    | 120 search requests per user per minute (`/api/search`, `/home`, and `/track` each); 40 external searches per user per minute per GoHighLevel or BambooHR provider.                                                            |
| No LLM         | Ranking is deterministic. Nothing calls a model.                                                                                                                                                                               |
| Index          | Supabase candidates use the trigram, full-text, and identifier GIN indexes, capped at 120 candidates per provider before the TypeScript re-rank.                                                                               |

## Measured results

All figures are measured, not estimated. Machine: the developer's Mac. Date: 2026-10-23.

### End to end through the real route (Playwright, `tests/e2e/global-search.spec.ts`)

Dev server (`next dev`, not a production build), in-memory stores, synthetic JobTread
fixture. 10 queries (tools, reports, a job name, a job number, a partial address, agents,
knowledge, and others), each run 3 times after a warm-up pass. 30 samples.

| Configuration                                                                                | Whole search p50 | Whole search p95 | First provider's results p50 | p95   |
| -------------------------------------------------------------------------------------------- | ---------------- | ---------------- | ---------------------------- | ----- |
| GoHighLevel off (E2E default)                                                                | 10 ms            | 19 ms            | 10 ms                        | 19 ms |
| Live GoHighLevel credentials from `.env.local` (first run, before E2E was isolated from GHL) | 333 ms           | 1,068 ms         | 17 ms                        | 63 ms |

The second row shows why streaming matters: Baxter-internal results render in about 17 ms
while the live CRM call takes about 0.3 s to 1 s.

### Ranker cost (unit benchmark, 5,000 synthetic documents)

Measured with `matchDocument` before an optimization pass: 195–630 ms per query over 5,000
documents. The slowest case was numeric queries, which were being fuzzy-matched (also a
correctness bug: "10042" could match "10043"). After the fix (numbers never fuzzy-match,
typo candidates must share a leading letter, tokens are deduplicated, edit distance uses
rolling typed rows), the same benchmark (median of 5 runs) gave:

| Query                     | Matches                    | Before   | After   |
| ------------------------- | -------------------------- | -------- | ------- |
| `synthetic project 42`    | 126                        | 218.5 ms | 41.3 ms |
| `10042`                   | 54 before (wrong), 1 after | 630.8 ms | 28.4 ms |
| `42 sample st`            | 111                        | 307.8 ms | 37.6 ms |
| `synthtic projct` (typos) | 5,000                      | 258.5 ms | 51.6 ms |
| `zzzz`                    | 0                          | 194.7 ms | 33.0 ms |

In Supabase mode the ranker only sees at most 120 index candidates per provider, so this cost
applies only to in-memory mode and registry providers.

### Production numbers

Not measured yet: this change hasn't been deployed. After deploy, `/admin/search` shows
p50 and p95 per provider and for whole searches, measured on each instance.
