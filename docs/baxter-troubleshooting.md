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

Hybrid retrieval: structured units → lexical → semantic embeddings. Exact spreadsheet facts outrank vector similarity. See `docs/baxter-retrieval.md`.

## Conversation history

Recent messages from the same conversation help true follow-ups (pronouns, short field questions). New subjects, company-wide aggregations, and time filters (**“this year”**) reset prior entity context.

Send **`/clear`** (web or Slack) or use **New chat** on web to start fresh. If Baxter still answers about an old project after a new topic, clear context and ask again.

## Common errors

| Code                             | Meaning                               |
| -------------------------------- | ------------------------------------- |
| `BAXTER_STRUCTURED_QUERY_FAILED` | Structured planner/search error       |
| `BAXTER_AGGREGATION_FAILED`      | Temporal/sales aggregate failed       |
| `BAXTER_VECTOR_SEARCH_FAILED`    | Embedding/semantic search error       |
| `BAXTER_CONTEXT_RESET_FAILED`    | `/clear` could not reset conversation |
| `BAXTER_MULTIMODAL_INDEX_FAILED` | Image/PDF/slide indexing error        |

---

## OpenAI configuration errors

| Symptom                | Likely code                                                  | Fix                                       |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| Chat fails immediately | `BAXTER_OPENAI_KEY_MISSING`                                  | Set `OPENAI_API_KEY` in Vercel Production |
| Auth errors            | `BAXTER_OPENAI_AUTH_FAILED`                                  | Rotate/fix key; redeploy                  |
| Timeouts / 5xx         | `BAXTER_OPENAI_TIMEOUT`, `BAXTER_OPENAI_SERVICE_UNAVAILABLE` | Retry; check OpenAI status                |
| Request too large      | `BAXTER_OPENAI_REQUEST_TOO_LARGE`                            | Shorter question                          |
| Odd JSON               | `BAXTER_OPENAI_MALFORMED_RESPONSE`                           | Check model; run pipeline test            |

Employee messages may include `Reference: CODE` without revealing secrets.

---

## OpenAI quota vs rate limit (important)

Not every HTTP **429** is temporary. Baxter classifies OpenAI failures differently:

| Type                     | Example codes                                                                                           | Retryable?                                                            | What admins should do                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quota / billing**      | `BAXTER_OPENAI_QUOTA_EXCEEDED`, `BAXTER_OPENAI_BILLING_REQUIRED`, `BAXTER_OPENAI_PROJECT_LIMIT_REACHED` | **No** — retrying will not help                                       | Verify OpenAI billing, project budget, usage limits, and that the key belongs to the expected project. Fix billing, then redeploy and retest. |
| **Temporary rate limit** | `BAXTER_OPENAI_RATE_LIMITED`, `BAXTER_OPENAI_TOKEN_LIMITED`                                             | **Yes** — Baxter retries automatically (up to 2 retries with backoff) | Wait and retry. Reduce concurrent diagnostics. Optionally set `BAXTER_OPENAI_FALLBACK_MODEL` for model-specific TPM limits.                   |
| **Service unavailable**  | `BAXTER_OPENAI_SERVICE_UNAVAILABLE`                                                                     | **Yes**                                                               | Wait; check OpenAI status page                                                                                                                |

**Rule of thumb:** If employees see “administrator attention” / quota wording, fix **billing and limits** — do not tell them to “try again in a minute.” If they see “a lot of requests right now,” it is likely a **temporary** limit.

Launch readiness (`/admin/baxter/launch-readiness`) tracks quota errors in the last 24 hours separately from successful answers.

---

## Google connector errors

### Private key issues

| Symptom                     | Code                                | Fix                                                                          |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| Auth fails before API calls | `BAXTER_GOOGLE_PRIVATE_KEY_INVALID` | Re-paste full PEM from JSON key; use real newlines or `\n` escapes; redeploy |
| JWT signing fails           | `BAXTER_GOOGLE_PRIVATE_KEY_INVALID` | Key corrupted in Vercel — paste again without extra quotes                   |

Baxter normalizes keys (strips quotes, converts `\n`, validates BEGIN/END markers). Test at `/admin/connectors/google` → **Test authentication**.

### Shared Drive and folder access

| Symptom                  | Code                                     | Fix                                                          |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------ |
| Folder not found         | `BAXTER_GOOGLE_FOLDER_NOT_FOUND`         | Verify folder ID or URL                                      |
| Drive API disabled       | `BAXTER_GOOGLE_DRIVE_API_DISABLED`       | Library → enable Google Drive API                            |
| Permission denied        | `BAXTER_GOOGLE_PERMISSION_DENIED`        | Confirm connected Workspace user can open the folder         |
| Shared Drive not visible | `BAXTER_GOOGLE_SHARED_DRIVE_NOT_VISIBLE` | Use Workspace OAuth as an Acton member; SA is often external |
| Reauth required          | `BAXTER_GOOGLE_REAUTHORIZATION_REQUIRED` | Admin → Google Workspace → Reconnect                         |

Prefer **Connect Google Workspace** as `baxter@actonadu.com`. See `docs/google-workspace-oauth-setup.md`.

Run **Test connection** / **Test root folder** for friendly guidance (not raw JSON).

### Cron / process-jobs

Opening `/api/internal/process-jobs` in a browser returns **Invalid cron secret** / 401. That is expected — browsers do not send `Authorization: Bearer`. Use **Sync changes** on `/admin/connectors/google`. Prefer `CRON_SECRET` in Vercel; `INTERNAL_CRON_SECRET` is a legacy alias.

Full Google setup: **`docs/google-workspace-oauth-setup.md`**, **`docs/google-connector.md`**, and **`docs/google-drive-knowledge-manager.md`**

---

## GoHighLevel connector

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `401` “token is not authorized for this scope” on Test connection | Missing scope on that endpoint (often not a bad token) | Mapped as `BAXTER_GHL_SCOPE_MISSING`. Edit PIT permissions in GHL (usually **no** new token). Refresh permissions in Baxter. |
| Entire connector Offline when Voice AI / docs fail | Fixed in Prompt 2 | Core CRM (contacts/pipelines/opportunities) can succeed while optional caps warn |
| OAuth client ID/secret required in PIT mode | Misconfiguration | PIT needs only token + `GHL_LOCATION_ID`. Leave OAuth vars blank. |
| Writes refused | Missing `contacts.write` / `opportunities.write`, or user role | Admins allowed by default; sales need `ENABLE_GHL_WRITES_FOR_SALES=true` |
| Confirm does nothing | Pending action expired (~10 min) or stale CRM state | Ask Baxter to propose the change again |

Full guide: **`docs/gohighlevel-connector.md`**, actions: **`docs/gohighlevel-actions.md`**.

---

## Knowledge Base deletion

| Symptom                                            | Cause                                                                 | Fix                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| “An unexpected error occurred” on delete (pre-012) | `baxter_message_sources` FK `ON DELETE RESTRICT` when entry was cited | Apply migration **012**; archive cited entries instead of hard delete |
| Google-managed cannot delete                       | Intentional                                                           | Use Google Drive Sources → Remove from Baxter                         |
| Storage delete failed                              | Bucket missing or policy                                              | Confirm `knowledge-uploads` bucket from migration 012                 |

## Knowledge uploads

See **`docs/knowledge-imports.md`**.

Open **`/admin/baxter/diagnostics`** as an admin.

Actions:

1. **Test OpenAI** — asks the model to reply OK.
2. **Test Knowledge search** — searches approved KB for “Baxter”.
3. **Test complete pipeline** — runs `answerBaxterQuestion("Who is Baxter?")`.
4. **Create Baxter Overview entry** — idempotent approved starter entry.

Never displays secret values (only Yes/No).

**Launch readiness:** `/admin/baxter/launch-readiness` — overall pilot/rollout status.

**Feedback:** `/admin/baxter/feedback` — recent negative web chat ratings.

---

## Verify “Who is Baxter?”

1. Optionally bootstrap Overview or approve Project Brief.
2. Ask on `/` chat: “Who is Baxter?”
3. Expect identity and/or grounded answer with Sources when KB matches.

---

## Logging rules

Log error codes, user/conversation IDs, provider, model, latency.  
Do **not** log API keys, tokens, full private prompts, or entire proprietary documents.

---

## Slack

Full Slack setup and troubleshooting: **`docs/slack-setup.md`** (sections 19–20).

Quick checks:

1. Open `/admin/slack` — confirm health is **ready** (not `misconfigured` or `offline`).
2. Run **Test Slack authentication** from the admin diagnostics panel.
3. Confirm migration **009** applied (`slack_event_receipts` table exists).
4. Confirm `SLACK_ALLOWED_TEAM_IDS` includes the Acton workspace team ID.
5. For channel mentions, add channel IDs to `SLACK_ALLOWED_CHANNEL_IDS` and `/invite @Baxter`.
6. For DMs only, leave `SLACK_ALLOWED_CHANNEL_IDS` empty.
7. **`SLACK_REPORT_USER_ID` is optional** — only for `/property` report ownership; Q&A does not need Supabase users per Slack employee.

Common Slack issues:

| Symptom                             | Fix                                                            |
| ----------------------------------- | -------------------------------------------------------------- |
| No DM replies                       | `SLACK_ENABLE_DMS=true`, valid bot token, `OPENAI_API_KEY` set |
| Mentions ignored                    | Add channel to `SLACK_ALLOWED_CHANNEL_IDS`; invite Baxter      |
| Duplicate replies                   | Should not happen — check migration 009                        |
| `not_in_channel`                    | `/invite @Baxter`                                              |
| Auth failures                       | Refresh `SLACK_BOT_TOKEN` after reinstall                      |
| Thread follow-up ignored in channel | Expected — `@Baxter` again                                     |
| Source links broken                 | Set `NEXT_PUBLIC_APP_URL=https://acton-baxter.vercel.app`      |

Slack error codes use the `BAXTER_SLACK_*` prefix.

Admin conversation detail: `/admin/slack/conversations/[id]`
