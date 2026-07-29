# Slack Search — live organizational context (Prompt 1)

Baxter can search Acton’s Slack workspace **live at query time**. Slack remains the source of truth.

## Hard constraints

- **No** `slack_messages` / history / embedding tables in Supabase
- **No** automatic Slack → Knowledge Center promotion
- Authorization is enforced **before** evidence is returned to any LLM
- Prompt 1 exposes `retrieveSlackEvidence()`; Prompt 2 wires it into `answerBaxterQuestion()`

## Chosen architecture

### Primary API: Real-time Search (`assistant.search.context`)

Verified against current Slack docs (Real-time Search / former Data Access API):

| Concern             | Behavior                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Preferred endpoint  | `assistant.search.context`                                                                      |
| Fallback            | `search.messages` (user token + legacy `search:read`) if RTS unavailable                        |
| Bot token           | Public channels only; requires `action_token` from Slack message events                         |
| User token          | Searches content **that Slack says that user can access**; no `action_token` required           |
| Private / DM / MPIM | User token + granular `search:read.private` / `.im` / `.mpim`                                   |
| Limit               | ≤20 results per page; Baxter caps pages                                                         |
| Context             | `include_context_messages` + optional `conversations.replies` / bounded `conversations.history` |
| Permalinks          | Returned by RTS or via `chat.getPermalink`                                                      |

### Why this architecture

1. Slack’s modern AI search APIs are designed for LLM context without storing customer messages externally.
2. User-token search enforces Slack’s own ACL model (critical for private channels and DMs).
3. Bot-token public search is useful inside Slack (with `action_token`) but must never be treated as omnipotent access to private/DM content.
4. Legacy `search.messages` rejects bot tokens (`not_allowed_token_type`) and is only a user-token fallback.

## Authorization model

```
Web Baxter user  → slack_search_connections (encrypted user token) → search
Slack Baxter user → same mapping by slack_user_id, or bot+action_token (public only)
Admin sandbox     → optional SLACK_SEARCH_USER_TOKEN restricted to public_channel
```

Private channels, DMs, and MPIMs are **never** searched with a credential that does not belong to the requesting employee.

## Code entry points

| Export                     | Role                                         |
| -------------------------- | -------------------------------------------- |
| `planSlackSearch()`        | NL → validated `SlackQueryPlan`              |
| `executeSlackSearchPlan()` | Live search for one plan (composable)        |
| `retrieveSlackEvidence()`  | Plan + auth + search + filter (Prompt 2 API) |

Source: `src/lib/baxter-data/slack/`

## Admin

`/admin/slack` → Advanced health → **Slack Search** panel:

- Capability matrix (public / private / DM / MPIM / threads / permalinks)
- Link Slack Search (user OAuth)
- Test user/channel resolution, public search, thread retrieval
- Sandbox search with safe excerpts + Open in Slack

## Setup checklist

1. Apply migration `029_slack_search_connections.sql`
2. Update Slack app from `docs/slack-app-manifest.yaml` and **reinstall**
3. Add OAuth redirect URL for search callback
4. Set Vercel env:
   - `ENABLE_SLACK_SEARCH=true`
   - `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` (already used)
   - Token encryption key (`GHL_TOKEN_ENCRYPTION_KEY`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, or `SLACK_TOKEN_ENCRYPTION_KEY`)
   - Optional: `SLACK_SEARCH_USER_TOKEN` for admin public-only sandbox
5. Admin links Slack Search from `/admin/slack`
6. Run admin tests A–L in the Prompt 1 acceptance list

## Source type

Evidence is tagged `sourceType: "slack"` — conversational / current organizational context, **not** approved Knowledge Center policy.
