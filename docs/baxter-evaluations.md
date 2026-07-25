# Baxter evaluations

Admin evaluation foundation (Prompt 2). Prompt 3 expands judging and coverage.

## Storage

Migration `017_hybrid_retrieval_and_evals.sql` adds:

- `baxter_eval_cases`
- `baxter_eval_runs`

Dev/mock mode also seeds in-memory cases (Lori Harris structured facts, semantic, multimodal).

## Categories

`identity`, `procedure`, `policy`, `structured_lookup`, `structured_aggregation`, `semantic_lookup`, `cross_source`, `multimodal`, `general`, `knowledge_gap`

## Runner

Server-side deterministic checks:

- expected numeric/date/phrase facts
- expected source IDs when provided
- retrieval mode / latency / provider metadata

No LLM-as-judge required for these checks.

## Admin UI

`/admin/baxter/evaluations`

- Run one case
- Run enabled suite
- Pass/fail by category
