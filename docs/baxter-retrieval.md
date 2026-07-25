# Baxter hybrid retrieval

Baxter retrieves Acton knowledge with complementary strategies. Deterministic structured lookup from Prompt 1 is never replaced by embeddings.

## Pipeline

1. Understand intent (`planKnowledgeQuery`)
2. Apply conversation context policy (inherit vs reset entities)
3. Structured retrieval (spreadsheet rows, aggregates, exact values, **temporal filters**)
4. Lexical retrieval (exact terms, acronyms, names)
5. Semantic retrieval (embeddings over document/image/slide units)
6. Rank + dedupe (structured outranks vectors for exact data)
7. Reason + answer with citations to the parent approved source

## Conversation context (Prompt 3)

| Kind                    | Examples                                      | Behavior                 |
| ----------------------- | --------------------------------------------- | ------------------------ |
| True follow-up          | “when did she close?”, “what was the margin?” | Inherit prior entities   |
| New subject / aggregate | “How much have we sold this year?”            | **Reset** prior entities |
| Ambiguous short field   | “And the cost?”                               | Inherit if no new topic  |

`/clear` (web + Slack plain text) closes the active conversation and starts fresh. Prior messages remain for admin diagnostics.

## Temporal sales aggregation

“How much have we sold this year?” → sum `Agreement Amount` where `Close Date` is in the current calendar year (server date). Phrased as **agreement value sold** — not recognized revenue.

Supported phrases include: this/last year, YTD, this/last month, trailing 12 months, since January, in 2025/2026, Q1–Q4.

## Ranking rules

1. Exact structured evidence
2. High-confidence exact lexical
3. Semantic matches
4. Supporting document context

For procedural questions, semantic + lexical may outrank structured. For exact data questions, structured must win.

## Citations

- PDF units: include **Page N** when available
- Slides: include **Slide N** when available

## Inspector

`/admin/baxter/diagnostics` → Retrieval inspector shows question, context decision, inherited/reset entities, intent, time filters, structured query/aggregation, lexical/semantic/multimodal candidates, and final evidence — without chain-of-thought.
