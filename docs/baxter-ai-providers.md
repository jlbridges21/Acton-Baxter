# Baxter AI providers

## Separation of concerns

| Variable                                               | Controls                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                                          | **Property Research** report AI only (`deterministic` / `openai` / `anthropic`). Does **not** drive Baxter chat. |
| `PROPERTY_RESEARCH_AI_PROVIDER`                        | Optional alias; when set, overrides `AI_PROVIDER` for Property Research.                                         |
| `BAXTER_LLM_PROVIDER`                                  | Baxter chat primary reasoning (`openai` or `anthropic`).                                                         |
| `BAXTER_LLM_FALLBACK_PROVIDER`                         | Optional fallback reasoning provider for temporary outages only.                                                 |
| `BAXTER_OPENAI_MODEL` / `BAXTER_ANTHROPIC_MODEL`       | Baxter reasoning models.                                                                                         |
| `BAXTER_OPENAI_FALLBACK_MODEL`                         | Optional second OpenAI model inside the OpenAI provider (model-level fallback).                                  |
| `BAXTER_EMBEDDING_PROVIDER` / `BAXTER_EMBEDDING_MODEL` | Embeddings (OpenAI `text-embedding-3-small` by default).                                                         |
| `BAXTER_VISION_PROVIDER` / `BAXTER_VISION_MODEL`       | Image analysis during indexing.                                                                                  |

## Fallback rules

Fallback runs only for temporary provider failures (timeouts, 5xx, rate limits).

It does **not** run for:

- missing API keys / config mistakes
- auth failures that need admin action
- safety rejection
- empty structured retrieval

Healthy operation uses a single reasoning call.

## Diagnostics

`/admin/baxter/diagnostics` shows providers/models (never secrets) and test buttons for primary reasoning, fallback, embeddings, and vision.
