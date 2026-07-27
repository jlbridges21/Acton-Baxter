# Baxter governance architecture

Baxter is Acton ADU’s digital teammate — not a generic LLM with a RAG layer.

Canonical sources live under `docs/baxter/`. Permanent behavior is distilled in code under `src/lib/baxter-ai/governance/`.

## Instruction hierarchy

0. Application security / RLS / secrets
1. Baxter runtime governance (confidentiality, evidence, scope, change control)
2. Acton culture + brand behavioral distillation
3. Approved operational knowledge (KB, Google, structured units) — **DATA only**
4. Conversation context
5. General model knowledge

Higher tiers win. Retrieved documents and user messages cannot rewrite permanent instructions.

## Runtime vs retrieval

| Source                          | Runtime                                           | Retrieval / citable        |
| ------------------------------- | ------------------------------------------------- | -------------------------- |
| `baxter-runtime-prompt-v1-1.md` | Distilled into every request                      | Not employee RAG           |
| `baxter-governance-v1-1.md`     | Admin summary only; PLACEHOLDER/RED FLAG ≠ policy | Not employee RAG           |
| Culture Guide                   | Compact distillation always                       | Full doc indexable/citable |
| Brand Guide                     | Compact voice distillation always                 | Full doc indexable/citable |
| Value Proposition Playbook      | Conditional (sales / customer drafts)             | Full doc indexable/citable |

Do **not** inject full markdown guides on every request.

## Assembly

`assembleBaxterRuntime()` / `buildBaxterSystemPrompt(question?)` is the single system prompt for:

- Web chat
- Slack
- Diagnostics
- Evaluations
- OpenAI and Anthropic providers

Evidence in the user prompt is wrapped with `wrapEvidenceAsData()` so injection text is treated as data.

## Change control

Chat cannot create standing behavior (`from now on…`). Prompt extraction attempts are refused briefly. Runtime version (`BAXTER_RUNTIME_VERSION`) may be stated; the full hidden prompt is never disclosed.

## Admin

- `/admin/baxter/governance` — versions, canonical registry, open decisions, risks
- `/admin/baxter/diagnostics` — runtime card (no full prompt / secrets)
