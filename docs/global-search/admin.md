# Admin page: `/admin/search`

Admins only (the server redirects everyone else; `/api/admin/search` returns 403). Listed in
the page registry as **Global Search** under the AI Governance settings, so admins can find
it from search.

## What it shows

- **Performance (measured):** samples, p50, p95, and slowest whole-search latency recorded on
  this server instance, plus a **test query** that runs as you and shows status, result
  count, and latency per provider. Never result contents.
- **Per provider:** category, source, indexing mode, timeout, description, permission rule,
  availability (with the reason when unavailable), measured latency (runs, p50, p95,
  timeouts, errors), and for indexed providers the index status, record count, last refresh,
  duration, refresh interval, and last failure.

## What admins can change

| Control                            | Rules                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reindex** (one provider, or all) | Indexed providers only. Audited (`search.reindex`).                                                                                                                                    |
| **Enabled**                        | Optional providers only. Disabling purges indexed rows at once. Core providers (tools, settings, agents, reports) can't be disabled. Audited.                                          |
| **Searchable fields**              | Only fields marked `standard` by the provider. Restricted fields appear with a lock and can't be selected; the API refuses them (`400`). Indexed providers rebuild on change. Audited. |
| **Synonyms**                       | Two-way word synonyms (e.g. `hr` ↔ `bamboohr`), up to 10 per term, letters and numbers only. Synonym matches never outrank direct matches. Audited.                                    |

Settings live in `global_search_providers` and `global_search_synonyms` (migration 074) and
take effect within 30 seconds on every server instance (settings cache TTL).
