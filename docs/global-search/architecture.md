# Architecture

```
Header button / ⌘K ─► SearchModal (client)
                        │  200 ms debounce · AbortController · sequence guard
                        ▼
              GET /api/search?q=&category=&limit=&offset=    (NDJSON stream)
                        │  requireActiveUser → SearchContext → rate limit
                        ▼
                  engine.runSearch
       ┌────────────────┼──────────────────────────────┐
       ▼                ▼                              ▼
  registry providers  live providers               indexed providers
  (tools, settings,   (reports, GHL contacts,      (JobTread jobs, knowledge,
   agents)             GHL opportunities,           inventory, inspections)
                       BambooHR, AI tasks)          global_search_index → lookup()
       └────────── each: canUse → availability → search (own timeout) ─────────┘
                        │
                        ▼
      toSearchResult: rank (rank.ts) · highlight · safeText · validateResultUrl
                        │
                        ▼
      stream {type:"provider"} per provider as it finishes → {type:"done"}
```

## Files

| Path                                                                     | Role                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/lib/navigation/registry.ts`                                         | Canonical registry of pages, tools, and settings (header, dashboard links, search) |
| `src/lib/search/types.ts`                                                | Result contract, categories, stream events (client-safe)                           |
| `src/lib/search/provider.ts`                                             | Provider contract                                                                  |
| `src/lib/search/registry.ts`                                             | The provider list (the only registration point)                                    |
| `src/lib/search/context.ts`                                              | Per-request authorization context (memoized access lookups)                        |
| `src/lib/search/engine.ts`                                               | Concurrency, timeouts, ranking, safety, address grouping, streaming                |
| `src/lib/search/rank.ts`                                                 | Deterministic tiers, typo tolerance, highlighting, boosts                          |
| `src/lib/search/normalize.ts`                                            | Text, identifier, phone, and address normalization                                 |
| `src/lib/search/safety.ts`                                               | Snippet sanitizing and URL allow-listing                                           |
| `src/lib/search/index-store.ts`                                          | Index retrieval (ACL in SQL) and lifecycle                                         |
| `src/lib/search/settings.ts`                                             | Provider enable/disable, approved fields, synonyms, index state                    |
| `src/lib/search/home.ts`                                                 | Empty-query view, recents, usage tracking                                          |
| `src/lib/search/admin.ts`                                                | Admin overview, commands, scheduled refresh                                        |
| `src/lib/search/metrics.ts`                                              | Measured latency ring buffer                                                       |
| `src/lib/search/client.ts`                                               | Stream reader, sections, freshness labels, Ask Baxter hand-off                     |
| `src/components/search/*`                                                | Header button, modal, client hook                                                  |
| `src/app/api/search/**`, `src/app/api/admin/search`                      | Route handlers (handlers only; logic lives in `src/lib`)                           |
| `src/app/admin/search/page.tsx`, `src/components/admin/search-admin.tsx` | Admin page                                                                         |
| `supabase/migrations/074_global_search.sql`                              | Tables, indexes, and the query function                                            |

## The result contract

Every provider's output becomes a `SearchResult` (`src/lib/search/types.ts`): `id`,
`provider`, `category`, `title`, `subtitle`, `description`, `breadcrumb`, `highlight`, `url`,
`external`, `icon`, `avatarUrl`, `sourceSystem`, `sourceLabel`, `recordId`, `updatedAt`,
`freshness`, `preview`, `auth` (authorization classification), `actions`, `tier`, `score`,
`addressKey`, and `addressDisplay`. Providers return `ProviderHit`s; the engine builds the
contract so every result gets the same sanitizing and URL validation.

## Ranking

`rank.ts` puts every match in a tier, best first:

1. exact title or name
2. exact identifier (job number, SKU, order number, full email or phone)
3. prefix (the title starts with the query, a title word does, an alias matches exactly, or an identifier starts with the query)
4. email or phone (partial)
5. address (normalized)
6. field match (every query word starts a word in an approved field)
7. fuzzy (typo tolerant: 1 edit for 4–6 letter words, 2 for longer)
8. description

Scores are `tier × 1000 + within-tier score`. Context boosts (pinned, recently opened, use
count) add less than 100, so they only reorder results inside a tier and can never outrank a
better match. Admin synonyms are tried only when the literal query does not match, and a
synonym match ranks no higher than a field match.

In the UI, sections are ordered by their best match (an exact customer name comes before a
fuzzy tool match), with ties in a fixed category order.

## No LLM in the loop

Search never calls a model. "Ask Baxter" hands the query to the existing Baxter chat (as a
prefilled draft, not sent automatically) only when the user clicks it.

## Address search

`normalize.ts` handles case, whitespace, punctuation, suffixes (Street→st, Avenue→ave,
Road→rd…), directionals (North→n…), unit designators (Apt, Suite, #→unit), and ZIP+4→ZIP,
with no geocoding API. The original address is always the one displayed. When results from
different sources share a normalized street address (and their city and ZIP don't conflict),
the response includes an `addressGroups` entry listing them. Records are never merged: each
stays its own row. The same street in a different city or ZIP is a separate group.
