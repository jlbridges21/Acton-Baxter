# Baxter troubleshooting

## Why Baxter says it doesn’t have approved knowledge

Usually one of:

1. No approved **internal** Knowledge Base entries match the question.
2. Matching entries are still **draft**, **archived**, or **admin_only**.
3. Google docs were never synced / not approved after sync.
4. The question is Acton-specific and Baxter correctly refuses to invent a policy.

Baxter should still help with identity and general questions even when the Knowledge Base is empty.

## General vs official Acton answers

- **Approved Acton knowledge** — grounded in KB / Google-synced entries, with Sources.
- **General guidance** — OpenAI general knowledge, not official Acton policy.
- **Mixed** — official answer missing; useful general explanation is clearly labeled.
- **Baxter information** — built-in identity profile.

## Built-in identity

`src/lib/baxter-ai/identity.ts` lets Baxter explain itself without KB entries.

## Retrieval

Deterministic keyword search with normalization (curly apostrophes), stop-word filtering, light stemming, and small synonym expansion. No embeddings yet.

## Conversation history

Recent messages from the same user conversation (about 10) are passed into the model for follow-ups.

## OpenAI configuration errors

| Symptom                | Likely code                        | Fix                                    |
| ---------------------- | ---------------------------------- | -------------------------------------- |
| Chat fails immediately | `BAXTER_OPENAI_KEY_MISSING`        | Set `OPENAI_API_KEY` in Vercel         |
| Auth errors            | `BAXTER_OPENAI_AUTH_FAILED`        | Rotate/fix key                         |
| Timeouts / 5xx         | `BAXTER_OPENAI_TIMEOUT`            | Retry; check OpenAI status             |
| Rate limits            | `BAXTER_OPENAI_RATE_LIMITED`       | Back off                               |
| Odd JSON               | `BAXTER_OPENAI_MALFORMED_RESPONSE` | Check model; diagnostics pipeline test |

Employee messages may include `Reference: CODE` without revealing secrets.

## Diagnostics

Open `/admin/baxter/diagnostics` as an admin.

Actions:

1. **Test OpenAI** — asks the model to reply OK.
2. **Test Knowledge search** — searches approved KB for “Baxter”.
3. **Test complete pipeline** — runs `answerBaxterQuestion("Who is Baxter?")`.
4. **Create Baxter Overview entry** — idempotent approved starter entry.

Never displays secret values (only Yes/No).

## Verify “Who is Baxter?”

1. Optionally bootstrap Overview or approve Project Brief.
2. Ask on `/` chat: “Who is Baxter?”
3. Expect identity and/or grounded answer with Sources when KB matches.

## Logging rules

Log error codes, user/conversation IDs, provider, model, latency.  
Do **not** log API keys, tokens, full private prompts, or entire proprietary documents.
