# Operations: deployment, recovery, monitoring, costs

## Deployment

1. **Database:** apply `supabase/migrations/071_sam_operations.sql`. It is additive, and it was validated on a scratch Postgres database, including a re-run.
   - It creates the `ops_*` tables, the private `ops-documents` bucket, three nullable columns on `ai_approval_requests`, and the `sam_operations_sweep` job type.
   - It needs migrations 067 (AI Workforce), 068, and 070 to be applied first.
   - **Do not apply to production without authorization.**
2. **Deploy the app.** No new npm dependencies were added.
3. **Cron:** the existing `/api/internal/process-jobs` cron enqueues the sweep every 15 minutes. No new cron entry is needed.
4. **Environment variables.** All are optional; each missing one leaves its integration in manual mode.
   - BambooHR: `BAMBOOHR_CLIENT_ID`, `BAMBOOHR_CLIENT_SECRET`, `BAMBOOHR_COMPANY_DOMAIN`, optional `BAMBOOHR_REDIRECT_URI` (apply migration `072_bamboohr_integration.sql` first). See [BambooHR integration](bamboohr.md).
   - DocuSign: `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY` (PEM, `\n` escapes allowed), `DOCUSIGN_ENVIRONMENT` (`demo` or `production`), and optionally `DOCUSIGN_BASE_URI`.
   - Google: re-consent the existing Baxter Google connection with `gmail.send` and Calendar scopes to enable sending and scheduling.
5. **First visit:** an administrator opens **Sam Operations**.
   - The starter workflows are seeded as unofficial drafts.
   - The leadership-brief documents are added to the Knowledge Hub for Sam.
   - Sam's published configuration is upgraded once, keeping admin edits.
6. Complete **Setup**. See the [handover checklist](handover-checklist.md).

## Recovery procedures

| Situation                             | What to do                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An integration was down               | Retryable failures retry automatically, up to 5 times. Afterwards, open **Approvals → Needs attention** and select **Retry**. The approval is re-checked and nothing runs twice |
| Credentials expired (401/403)         | Fix the credentials, use **Integrations → Test connection**, then **Retry** the failed actions                                                                                  |
| An action can't be done automatically | It shows **Needs manual completion** with exact instructions. Do it by hand, then select **Mark done by hand** with a note                                                      |
| A workflow is stuck                   | Open it. The step shows the reason (missing information, no Drive folder, declined request). Fix the input, or have the CEO or COO **skip the step** with a reason              |
| A wrong workflow was started          | The CEO or COO selects **Cancel workflow**. Every pending action and its approval is cancelled                                                                                  |
| A bad workflow version was published  | In **Versions**, select **Restore as draft** on the good version and publish it. Running workflows keep their version until migrated                                            |
| The sweep stopped                     | Check `/api/internal/process-jobs` cron logs. A `sam_operations_sweep` job should appear about every 15 minutes. State is persisted, so nothing is lost; the sweep catches up   |

## Monitoring

- **Overview tab:** pending approvals, items needing attention, overdue steps, upcoming renewals, setup progress, and connected integrations.
- **Activity tab and `ai_audit_log`:** every proposal, approval, execution, failure, override, and configuration change, as `ops.*` actions.
- Cron response JSON includes `samOperations: {enqueued, reason}`.
- Server logs: `processJob:sam_operations_sweep` errors.

## Support and maintenance

- **Owners to name:** an operational owner (keeps workflows current), a technical owner (integrations and credentials), and the CEO and COO (approvals).
- **Quarterly:** review the BambooHR allowlist, the autonomy rules, the HR administrators, and the Drive folders.
- **When a process changes:** edit the workflow in the Library. No developer is needed.
- **When a vendor changes its API:** a developer updates `src/lib/ops/integrations.ts`. The adapters are isolated there.

## Recurring operating costs

The code adds no new paid services. Costs depend on decisions still open; no prices are quoted here.

- **Anthropic:** Sam's model usage. Per-task limits are in Sam's configuration (default maximum $1 per task).
- **DocuSign:** an eSignature plan with API access is required for production envelopes. Confirm the plan, and whether MSP applies.
- **BambooHR:** API access is included with BambooHR accounts; confirm the plan's limits.
- **Existing Supabase, Vercel, Google Workspace, and Slack:** small additional storage and cron usage.
