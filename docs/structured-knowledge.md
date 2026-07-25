# Structured Knowledge (Baxter Intelligence Prompt 1 of 3)

Baxter now supports **two kinds of knowledge**:

1. **Document knowledge** — procedures, policies, Docs, PDFs, manuals (chunked by headings/paragraphs)
2. **Structured data** — Google Sheets, XLSX, CSV (tables, rows, summary metrics)

## Knowledge entries vs units

- `knowledge_entries` remain the human-facing source records in the Knowledge Center.
- `knowledge_units` are the internal retrieval layer (chunks / spreadsheet rows). Admins do not manage units as separate entries.

## Spreadsheet ingestion

Parsers detect the real header row (not always row 1), extract:

- Data rows as `Header: value` text **and** JSON cell values (display + numeric/date/percent)
- Summary metrics (Total Contracts, Total Agreement Value, …)
- Notes (e.g. estimated cost caveats)
- Sheet `gid` for deep links

Raw `col2=` flattening is no longer the primary representation.

## Structured retrieval

`planKnowledgeQuery` → `searchStructuredKnowledge` resolves entity + field (e.g. Lori Harris + Agreement Amount) **deterministically** before OpenAI.

Web and Slack share the same path via `retrieveBaxterEvidence`.

Embeddings are **not** used for exact spreadsheet lookup (Prompt 3).

## Reindex

Admin → Knowledge → Settings → **Rebuild Baxter index**

Or per-entry **Index** tab → Reindex.

After deploying migration `016`, re-sync Google Sheets (to store workbook grids) then rebuild the index.

## Diagnostics

`/admin/baxter/diagnostics` → **Retrieval inspector** shows query mode, matched sheet/entity/field/value, and evidence package.
