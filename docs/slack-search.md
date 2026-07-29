# Slack Search — live organizational context

Baxter searches Acton’s Slack workspace **live at query time** and reasons over authorized evidence in the shared `answerBaxterQuestion()` pipeline (web chat, Slack DMs, @mentions).

Slack remains the source of truth.

## Hard constraints

- **No** `slack_messages` / history / embedding tables in Supabase
- **No** Slack embeddings or background crawl
- **No** automatic Slack → Knowledge Center promotion
- Authorization is enforced **before** evidence reaches any LLM
- Legacy `search.messages` / bare `search:read` are **not** used

## APIs (current Slack guidance)

| Concern             | Behavior                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| Endpoint            | `assistant.search.context` only                                                  |
| Bot token           | Public channels; requires `action_token` from Slack events                       |
| User token          | Content Slack says that user can access; granular `search:read.*`                |
| Private / DM / MPIM | User token + `search:read.private` / `.im` / `.mpim`                             |
| Thread context      | RTS context messages + bounded `conversations.replies` / `conversations.history` |
| Permalinks          | From Slack APIs only — never model-invented                                      |

## Source authority

| Question type                                       | Prefer                                      |
| --------------------------------------------------- | ------------------------------------------- |
| Official process / policy                           | Knowledge / Rulebook (Slack may supplement) |
| Saved PEM fields                                    | PEM NEAT                                    |
| CRM stage / contact                                 | GoHighLevel                                 |
| What someone said / discussions / decisions-in-chat | Slack                                       |
| Current status                                      | GHL + Slack, then Knowledge                 |
| What can Baxter do                                  | Capability registry                         |

Slack is **conversational context**, not automatic approved policy. When Slack is newer than Knowledge, Baxter should explain both.

## Prompt 2 integration

1. `detectSlackSearchRole()` — primary / fallback / skip
2. `retrieveSlackForAnswer()` — plan, authorize, RTS search, bounded follow-ups, select evidence
3. Convert to `BaxterContextItem` (`sourceType: "slack"`)
4. Merge into shared LLM evidence with source-authority instructions
5. Persist safe follow-up state in `conversation.metadata.slackContext` (refs only — no message bodies)

Entry points:

- `retrieveSlackEvidence()` — low-level provider
- `retrieveSlackForAnswer()` — answer-pipeline orchestration

## Employee setup

1. Apply migration **029**
2. Reinstall Slack app from `docs/slack-app-manifest.yaml` (granular search scopes; **remove legacy user `search:read`** if present)
3. `ENABLE_SLACK_SEARCH=true` + OAuth client + token encryption key
4. Employees: **Integrations** → Connect Slack Search (`/settings/integrations`)
5. Admins: `/admin/slack` diagnostics + sandbox

## Do not claim

- Exhaustive “nobody discussed this” unless search guarantees it
- Capabilities not granted by the user’s OAuth scopes
- Private/DM content retrieved with another employee’s token
