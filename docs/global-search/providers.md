# Providers and the registration convention

A provider owns one domain. It says what it searches, who may use it, and how it finds
records. The engine handles timeouts, ranking, highlighting, sanitizing, URL validation, and
the response format, so providers stay small.

## Convention

1. **One file per domain** in `src/lib/search/providers/<domain>.ts`, exporting a
   `SearchProvider` (`src/lib/search/provider.ts`).
2. **Register it in one place:** add it to `PROVIDERS` in `src/lib/search/registry.ts`.
   Nothing else is needed. Categories, pills, admin rows, and the docs table come from the
   registry.
3. **Derive, don't hardcode.** Read records from the system that already owns them (page
   registry, Agent Registry, Reports repo, JobTread cache, connector APIs). Never list current
   reports, agents, or tools in a provider.
4. **Authorize with existing rules.** `canUse(ctx)` gates the whole provider. `search` and
   `lookup` return only records `ctx` may see, using the domain's own permission functions.
   Never invent a parallel permission model.
5. **Return only approved, viewer-visible fields** in `ProviderHit.match` and in the display
   fields. Restricted fields are declared with `sensitivity: "restricted"` so they show as
   locked on the admin page and can never be enabled.
6. **Links:** build URLs only from ids the source returned. Run every id through `safeId`.
   External links must be on the allow-list in `safety.ts`.
7. **Be honest about freshness:** `{ kind: "live" }` for live queries, `{ kind: "cached",
syncedAt, label }` for caches. Never label cached data as live.
8. **Implement `lookup(ctx, ids)`** whenever records can be re-read by id. Recents and
   indexed search depend on it. Without it, opened records aren't stored in recents.

## Contract summary

| Field                                                           | Meaning                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`, `name`, `category`, `icon`, `sourceSystem`, `description` | Identity and display                                                                          |
| `searchableFields`                                              | Approved (`standard`) and locked (`restricted`) fields; admins choose among standard ones     |
| `filters`                                                       | Optional filter keys the provider understands                                                 |
| `optional`                                                      | Optional providers can be disabled by an admin; core ones cannot                              |
| `indexing`                                                      | `registry` (in-process list), `live` (queried per search), or `index` (`global_search_index`) |
| `permissionSummary`                                             | Human description of the rule (admin page and docs)                                           |
| `minQueryLength`, `timeoutMs`                                   | Per-provider limits                                                                           |
| `canUse(ctx)`                                                   | Server-side gate. `false` hides the provider and its category                                 |
| `availability()`                                                | Connection state. When unavailable, the provider reports a status, never "no results"         |
| `search(ctx, input)`                                            | Returns `{ hits, hasMore?, freshness? }`                                                      |
| `lookup?(ctx, ids)`                                             | Re-authorized re-read by id                                                                   |
| `emptyState?(ctx)`                                              | Items for the empty-query view                                                                |
| `indexer?`                                                      | `{ refreshMinutes, fetchAll() }` for indexed providers                                        |

## Registered providers

| Provider             | Category         | Indexing | Source                                     | Permission                                                           |
| -------------------- | ---------------- | -------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `tools`              | Tools & Pages    | registry | Canonical page registry + BAXTER_TOOLS     | Role + per-page `requires`                                           |
| `settings`           | Settings         | registry | Canonical page registry                    | Role + per-page `requires`                                           |
| `agents`             | AI Agents        | registry | AI Agent Registry                          | `canViewWorkspace`; drafts admin-only; chat link needs Direct chat   |
| `reports`            | Reports          | live     | Reports repo + groups                      | Reports access + per-report `permissionFor`                          |
| `ghl-contacts`       | Customers        | live     | GoHighLevel `POST /contacts/search`        | Connector role policy (admin, salesperson)                           |
| `ghl-opportunities`  | Opportunities    | live     | GoHighLevel `GET /opportunities/search`    | Connector role policy                                                |
| `jobtread-jobs`      | Jobs             | index    | `jt_jobs` cache                            | Reports `general` category; customer fields need `customer`          |
| `bamboohr-employees` | Employees        | live     | BambooHR `GET /v1/employees`               | CEO, COO, HR admins only; audited                                    |
| `knowledge`          | Knowledge        | index    | `knowledge_entries` (title, tags, summary) | `canUserReadKnowledgeEntry`                                          |
| `inventory`          | Inventory        | index    | `inventory_items`                          | Approved employees (same as the page)                                |
| `inspections`        | Site Inspections | index    | `site_inspections`                         | Approved employees (same as the page)                                |
| `ai-tasks`           | AI Tasks         | live     | `ai_tasks` via `listVisibleTasks`          | Own tasks or View activity; confidential tasks only for their author |

## Auto-indexed types (no code change for new records)

- **Pages and tools:** a new entry in `NAV_ENTRIES` is searchable on the next request.
- **Agents:** a newly published, active agent appears within the registry cache TTL (30 s).
- **Reports and report groups:** live, so a new report or group appears immediately.
- **JobTread jobs:** every job in `jt_jobs` is indexed; new jobs appear after the next
  JobTread sync plus index refresh (15 min interval, or "Reindex" on the admin page).
- **Knowledge, inventory, site inspections:** refreshed every 10, 5, and 10 minutes, and on
  demand from the admin page.
- **CRM contacts and opportunities:** live, so new GoHighLevel records are searchable at once.
- **AI tasks:** live.
