# Baxter PEM NEAT retrieval

Completed PEM NEATs are a **first-class Baxter evidence source**. Structured field questions are answered **deterministically** from the correct NEAT field — the LLM does not choose Type 1 vs Type 2.

## Pipeline

```
User question
  → PEM intent (help/definition vs record lookup vs selection reply)
  → pending clarification resolution ("Test 8") when active
  → prospect + discriminator parsing (case-insensitive)
  → authorize
  → load completed NEAT
  → getPemField(structured_result, requestedField)
  → deterministic answer + cite
```

Shared entry point: `answerBaxterQuestion()` (web + Slack).

## Root failure modes this architecture prevents

1. **Vague LLM paraphrase** — single-field questions return `formatDeterministicPemAnswer` from `getPemField`, never a broad NEAT dump for the model to misread.
2. **Lost PEM selection** — clarification stores `metadata.pemContext.pending`; "Test 8" resolves the **original** question.
3. **Failed name parse** — `parsePemEntityQuery` handles `robert vertin test 8` and ignores question words like "What is".

## Conversation state (`baxter_conversations.metadata.pemContext`)

No migration required — uses existing JSON metadata.

```ts
pending: { type: "pem_selection", originalQuestion, requestedFields, candidatePemIds, ... }
active:  { type: "pem_active", activePemId, activeProspectName, lastRequestedFields, ... }
```

`/clear` starts a new conversation → state cleared.

Explicit current-message entities (e.g. "Robert Vertin Test 8") override inherited active PEM.

## Field routing

`src/lib/baxter-data/pem-neats/fields.ts`

- Type 1 ≠ Type 2 (never substituted)
- Aliases: why build → Type 1; why Acton / contractor concerns → Type 2
- Null Type 1 → "does not contain a determinable Type 1 Pain" (not Type 2)

## Chat model

Baxter Q&A uses `BAXTER_CHAT_MODEL` (fallback: `BAXTER_OPENAI_MODEL` → `OPENAI_MODEL`).  
PEM generation continues to use `PEM_NEAT_OPENAI_MODEL` separately.

## Citations

Label: `{Prospect including Test N} — PEM NEAT`  
URL: `/pem-neats/{id}` (absolute via `APP_BASE_URL` for Slack)
