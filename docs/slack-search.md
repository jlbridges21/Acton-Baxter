# Slack Search — live organizational context

Baxter searches Acton’s Slack workspace **live at query time** and reasons over authorized evidence in the shared `answerBaxterQuestion()` pipeline (web chat, Slack DMs, @mentions).

Slack remains the source of truth.

## Hard constraints

- **No** `slack_messages` / history / embedding tables in Supabase
- **No** Slack embeddings or background crawl / ambient monitoring
- **No** automatic Slack → Knowledge Center promotion
- Authorization is enforced **before** evidence reaches any LLM
- Legacy `search.messages` / bare `search:read` are **not** used

## Architecture

```
Web / Slack event
  → answerBaxterQuestion()
  → detectSlackSearchRole() (primary | fallback | skip)
  → retrieveSlackForAnswer()
       → follow-up expand / topic reset
       → planSlackSearch() (intent, people, channels, time, keywords)
       → resolve credentials (user OAuth | bot+action_token public)
       → assistant.search.context (RTS)
       → optional exact conversations.history for latest_message
       ≤2 alternate searches when sparse
       → noise/bot filter + intent evidence budget
       → decision candidate ranking when needed
       → BaxterContextItem (sourceType: slack)
  → shared LLM + source authority
  → citations (permalinks only) + metadata.slackContext (refs only)
```

## Search intents

| Intent                | Example                                    |
| --------------------- | ------------------------------------------ |
| `person_statement`    | What did Jess say about…                   |
| `latest_message`      | Maxx’s last message in #project-management |
| `latest_update`       | Latest on the RACI matrix                  |
| `decision_search`     | When did we decide to…                     |
| `mention_search`      | Who mentioned…                             |
| `time_window_summary` | What happened last week with…              |
| `channel_search`      | Summarize #sales yesterday                 |
| `thread_context`      | Follow-ups in a known thread               |
| `topic_search`        | General Slack topic                        |

**Latest message:** chronological exactness (newest by timestamp), not semantic RTS ranking. Includes channel activity by that author (including thread replies when returned by Slack APIs).

## Source authority (intent-dependent)

| Question type                                  | Prefer                                                   |
| ---------------------------------------------- | -------------------------------------------------------- |
| Official process / policy / who is responsible | Rulebook / Knowledge (Slack may note temporary coverage) |
| Saved PEM fields                               | PEM NEAT                                                 |
| CRM stage / contact                            | GoHighLevel                                              |
| What someone said / decisions-in-chat          | Slack                                                    |
| Current status / latest                        | GHL + Slack, then Knowledge                              |
| Capability / what can you search               | Capability registry                                      |

When Slack conflicts with approved Knowledge, explain both — do not silently overwrite.

## Authorization

| Mode                                    | Access                                      |
| --------------------------------------- | ------------------------------------------- |
| User OAuth (`slack_search_connections`) | Content Slack says that user can access     |
| Bot + `action_token`                    | Public context only                         |
| Not connected (web)                     | Connect Slack CTA — no admin-token fallback |

Private / DM / MPIM never enter the model without the requester’s authorized token.

## Follow-ups

`conversation.metadata.slackContext` stores **references only**:

- topic, people, channels, timeRange label, intent
- message/thread refs + permalinks
- **no message bodies**

Resets on `/clear`, new chat, and detected **topic change**. Relative-time follow-ups (“What about this week?”) keep topic and replace the time window.

## Citations & persistence

- Web: Slack source cards with channel, author/title, time, **View in Slack**
- Slack mrkdwn: compact `<permalink|Author in #channel · date>` lines
- Citation dedupe by permalink
- Assistant message `metadata.sources` may store citation snapshots (title, permalink, labels) for answer integrity — **not** a Slack archive
- `baxter_message_sources` is Knowledge-entry UUID oriented; Slack synthetic ids are **not** inserted there (citations remain in `metadata.sources`)
- Topic-change follow-up reset clears `metadata.slackContext` even when the new search returns no hits
- Slack retrieval failures are logged and surfaced as employee-safe incomplete notes (not silently swallowed)

## Decision reasoning

Request-lifecycle decision candidates classify statements as suggestion / discussion / agreement / decision / implementation / reversal. Stale decisions after reversals are not presented as current.

## Evaluation

Deterministic suite: `src/lib/baxter-data/slack/eval-suite.ts`  
Admin: **Evaluations → Run Slack Recall** (`/admin/baxter/evaluations`)  
CI: `tests/unit/slack-recall-eval.test.ts` (mocked fixtures only)

## Employee setup

1. Migration **029**
2. Reinstall Slack app from `docs/slack-app-manifest.yaml` (granular search scopes; **remove legacy user `search:read`** if present)
3. `ENABLE_SLACK_SEARCH=true` + OAuth client + token encryption key
4. Employees: **Settings → Integrations** → Connect Slack Search
5. Admins: `/admin/slack` diagnostics + sandbox

## Admin rollout checklist

1. Migration 029 applied
2. Slack app reinstalled with current granular scopes
3. Legacy `search:read` removed if unused
4. `ENABLE_SLACK_SEARCH=true`
5. OAuth redirect verified
6. User links Slack from Settings → Integrations
7. Public test passes
8. Private authorized test passes
9. Unauthorized private test returns nothing
10. Slack DM / @mention test passes
11. View in Slack links work
12. Slack Recall eval suite passes

## Production smoke checklist

1. Connect Slack Search
2. Web: “What did [your name] say in #general today?”
3. Confirm answer + source opens Slack
4. DM Baxter: latest message you posted in #general
5. @Baxter in a public channel with a topic question
6. Confirm 👀 appears/removes
7. Private-channel question only from authorized user
8. Unauthorized private query returns nothing
9. `/clear` then “What did he say?” does not inherit old topic

## Limitations

- Not an exhaustive workspace scan (pagination / rate limits / permissions)
- Does not read Google Doc contents from Slack links unless already in Knowledge
- Channel follow-ups in Slack still require @Baxter when existing bot rules require it
- No background Slack monitoring

## Do not claim

- “I know everything in Slack”
- Exhaustive “nobody discussed this” unless search guarantees it
- Private/DM content retrieved with another employee’s token
