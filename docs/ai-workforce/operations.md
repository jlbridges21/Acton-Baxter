# AI Workforce — operations guide

## Deploying

1. Apply `supabase/migrations/067_ai_workforce.sql` (Supabase SQL editor or `supabase db push`). It is additive; the only change to an existing object is adding `ai_agent_task` to the `report_jobs.job_type` check. It is safe to re-run.
2. Confirm the `ai-agent-avatars` and `ai-agent-knowledge` buckets exist and Realtime includes `ai_agent_runtime_status` (the migration does both when the `supabase_realtime` publication exists).
3. Ensure `ANTHROPIC_API_KEY` is set (Sam defaults to Claude Opus 5.5) — or switch Sam's model to OpenAI in the AI model tab.
4. Deploy. On first use, Baxter, Sam, two AI departments, and the placeholder onboarding template are created automatically.
5. Grant HR staff access to Sam (Agents → Sam → Access) and upload approved documents.

Until step 1 is done, Baxter chat works exactly as before and the AI Workspace pages show a "database isn't set up yet" notice.

### Environment variables

| Variable                          | Required                                    | Purpose                            |
| --------------------------------- | ------------------------------------------- | ---------------------------------- |
| `ANTHROPIC_API_KEY`               | For Claude-based agents (Sam's default)     | Existing variable                  |
| `OPENAI_API_KEY`                  | For OpenAI-based agents, embeddings, Baxter | Existing variable                  |
| `AI_WORKFORCE_DELEGATION_ENABLED` | No (default `true`)                         | Set `false` to stop all delegation |

No other new variables. Baxter's model still comes from `BAXTER_LLM_PROVIDER` / `BAXTER_CHAT_MODEL` unless an admin chooses a model in the studio.

## Monitoring

- **Mission Control** (`/ai/mission-control`): running, completed, and failed tasks; approvals waiting; tokens and estimated cost by model; per-agent configuration vs availability vs activity.
- **Tasks**: per-task timeline and error code.
- Server logs: `[agents.delegation.routing_unavailable]`, `[agents.delegation.failed]`, `[agents.runtime_status.refresh_failed]`, `[agents.audit.failed]`.

## Troubleshooting

| Symptom                                    | Likely cause                                                | Fix                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Sam's AI provider isn't configured"       | Missing key for Sam's provider                              | Add the key in Vercel, or change Sam's model                                            |
| `MODEL_NOT_FOUND`                          | Model id not available to the account                       | AI model tab → Test connection; pick another model                                      |
| HR questions stay with Baxter              | Example requests don't cover the wording, or delegation off | Delegation tab → tester; add examples; check Baxter's Delegation tab                    |
| Unrelated questions go to Sam              | Over-broad keywords/examples                                | Add negative examples; remove broad key phrases; run all example checks                 |
| "doesn't have access to Sam"               | Person lacks _Ask through Baxter_                           | Access tab                                                                              |
| Slack: "couldn't match your Slack account" | No verified Slack→Baxter mapping                            | Have them sign in on the web with their Acton email, or add a mapping in Admin → Slack  |
| Task stuck "In progress"                   | Function crashed mid-run                                    | The cron sweep re-queues it after ~3 minutes; or Cancel/Retry on the task               |
| Document "Couldn't read"                   | Scanned PDF or empty file                                   | Upload a text-based version                                                             |
| Office status doesn't update live          | Realtime not enabled                                        | Status still refreshes every 15 s; add the table to the `supabase_realtime` publication |

## Costs

- Plain Baxter answers cost nothing extra; clear HR/non-HR requests are routed without any model call.
- Borderline requests make one small routing call on Baxter's model (switch the router to "Rules only" to avoid it).
- Each Sam assignment is typically 2–3 model calls. Per-task token and cost budgets (Sam's AI model tab → Safety limits) stop runaway work.
- Estimated costs use list prices in `src/lib/agents/models.ts`; OpenAI prices are marked as estimates. Check provider invoices for actual spend.

## Backups and recovery

- All configuration, tasks, approvals, documents, and onboarding data live in Supabase and are covered by Supabase backups. Knowledge files live in Storage.
- **Rollback a configuration**: Agents → (agent) → History → Restore.
- **Stop everything**: `AI_WORKFORCE_DELEGATION_ENABLED=false`, or pause the agent.
- **Recover failed work**: Tasks → filter Failed → Retry.

## Retention

Tasks, events, approvals, and audit rows are kept indefinitely in Phase 1. Recommended: decide a retention period with HR (for example 12 months for task content) and add a scheduled clean-up job before storing real employee matters at scale.
