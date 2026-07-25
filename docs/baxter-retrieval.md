# Baxter hybrid retrieval

Baxter retrieves Acton knowledge with complementary strategies. Deterministic structured lookup from Prompt 1 is never replaced by embeddings.

## Pipeline

1. Understand intent (`planKnowledgeQuery`)
2. Structured retrieval (spreadsheet rows, aggregates, exact values)
3. Lexical retrieval (exact terms, acronyms, names)
4. Semantic retrieval (embeddings over document/image/slide units)
5. Rank + dedupe (structured outranks semantic)
6. Reason + answer with citations to the parent approved source

## Intent modes

- `structured_lookup` / `structured_aggregation`
- `document_lookup` / `acton_procedure` / `multimodal_lookup`
- `hybrid` / `lexical` / `semantic`

## Ranking rules

- Exact entity + field matches score highest
- Structured confidence beats vector similarity
- Lexical exact phrases beat weak semantic hits
- Freshness is a tie-breaker, not an absolute filter
- Draft/archived/restricted parents exclude units

## Inspector

`/admin/baxter/diagnostics` → Retrieval inspector shows intent, structured/lexical/semantic candidates, and final ranked evidence without chain-of-thought.
