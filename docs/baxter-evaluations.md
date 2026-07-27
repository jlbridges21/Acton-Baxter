# Baxter evaluations

Production-oriented evaluation suite for Baxter Intelligence (Prompts 2–3).

## Storage

- Migration `017_hybrid_retrieval_and_evals.sql` — `baxter_eval_cases`, `baxter_eval_runs`
- Migration `018_conversation_reset_and_eval_indexes.sql` — eval run + active thread indexes
- Dev/mock mode seeds in-memory golden cases

## Categories

`structured_lookup`, `structured_aggregation`, `semantic_lookup`, `cross_source`, `multimodal`, `conversation_continuity`, `context_reset`, `citation`, `knowledge_gap`, plus earlier identity/procedure/policy/general.

## Checks

Deterministic (no LLM judge required):

- **Facts** — phrase / date presence
- **Numeric** — extract amount from answer vs expected (e.g. `352933`, year sold totals)
- **Sources** — expected source IDs when configured
- **Answer mode** — e.g. `clarification` after `/clear`
- **Forbidden phrases** — e.g. must not repeat Lori amount on year-sold follow-up
- **Multi-turn** — scripted turns including `/clear`

## Golden suite

Admin actions:

- Run enabled suite
- Run golden suite
- Run one / run category

IDs include Lori agreement/close, current-year sold + count, semantic procedure, cross-source, multimodal, PDF citation smoke, context reset, follow-up continuity, knowledge gap, and governance cases (`eval-gov-*`: standing-instruction refusal, prompt-extraction refusal).

Unit tests in `tests/unit/baxter-governance-runtime.test.ts` cover runtime assembly, evidence wrapping, value-prop conditioning, and PLACEHOLDER parsing.

## Admin UI

`/admin/baxter/evaluations`

Shows pass/fail (failures first), category accuracy labels, and recent results.
