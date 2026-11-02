# JobTread financial reporting: invoices, payments, tasks, PP#, snapshots, alerts

Status (2026-11-02): built and tested against the synthetic JobTread fixture. **Not committed,
not deployed, migration 084 not applied, nothing written to JobTread, no live JobTread calls
made.** JobTread is the only source; there is no QuickBooks integration.

## 1. Starting diagnostics (Dexter, 2026-11-02 10:00 UTC — not re-verified here)

| Reported                        | Classification          | Finding in code                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 449 jobs, 906 docs, 4,855 tasks | —                       | Counts come from the cache. This session had no production access, so they weren't re-checked; Data settings → Financial data now shows live counts.                                                                                                                                                                                                        |
| Invoiced Total on 3 jobs        | source data             | `job.invoicedTotal` sums customer invoices. Most jobs have none in JobTread (on 2026-10-22: 10 invoices, all drafts). Not a sync defect.                                                                                                                                                                                                                    |
| Project Manager on 63 jobs      | source data (likely)    | PM is the job option field mapped by `sem:project_manager`. The new audit sorts every gap into mapping, exclusion, sync, or blank in JobTread. No code defect was found in the value pipeline. One risk can't be checked offline: job custom field values are requested 60 per job (`CF_NODES`), so a job with more than 60 set values would lose the rest. |
| No invoice-level fields         | unsupported (by Baxter) | Documents fed only job rollups (`job.invoicedTotal` etc.). The new **documents** source adds 37 `doc.*` fields.                                                                                                                                                                                                                                             |
| No PP# identifiers              | mapping (no rule)       | No business rule exists. A configurable PP# mapping was added; nothing is guessed.                                                                                                                                                                                                                                                                          |
| Payments disabled, 0 records    | sync config + source    | `payments` isn't in `DEFAULT_ENABLED` (financial data starts off). The Data Catalog had no payment fields to verify. JobTread reported `organization.payments` count = 0 on 2026-10-22.                                                                                                                                                                     |
| Tasks not a report source       | unsupported (by Baxter) | `jt_tasks` was synced, but no report source read it. The new **tasks** source adds 15 `task.*` fields.                                                                                                                                                                                                                                                      |
| No snapshots / milestone links  | not built               | Built (see §4–5). Both start empty and are never backfilled.                                                                                                                                                                                                                                                                                                |

## 2. Field verification

The JobTread API docs (app.jobtread.com/docs) are a JavaScript app and couldn't be read, so no
field is assumed to exist:

- **Documents**: `dueDate, signedAt, updatedAt, tax, amountPaid, balance, account, customFieldValues` are optional. If JobTread answers `The field "x" does not exist`, that field is dropped and recorded in `jt_sync_entities.dropped_fields`. The report field is then hidden with reason `unsupported_api` (`FIELD_SYNC_ATTRIBUTE`).
- **Payments**: requested fields are `amount, date, type, createdAt, document, job, account`. `type` and `account` are dropped automatically if they're missing. The Data Catalog now verifies payment and parentTask fields.
- **Tasks**: `parentTask` is optional.
- Document custom fields are cached only for fields whose target looks like a document and that an admin hasn't excluded. No such target is in the synced metadata today, so the PP# `document_field` modes may have nothing to read until JobTread has those fields.

## 3. Phase 1 — data foundation

- Sources `documents` (`doc.*`), `payments` (`pay.*`), `tasks` (`task.*`) are registered in
  spec, fields, sources, the engine and the field route.
- Relationships by stable ID: `documents.job`, `payments.job`, `payments.document`, `tasks.job`. Rollups: `jobs.documents`, `jobs.payments`, `jobs.tasks`, `documents.payments`. All of them are in `DRILL_RELATED`, so they work with the existing drill drawer.
- Rows are keyed by JobTread ID, so a resync never duplicates them. Look-alike payments are flagged, not dropped.
- Status mapping (`bi_financial_settings.status_map`) maps raw JobTread type + status to Draft, Issued, Partially Paid, Paid, Voided or Unknown. Unmapped statuses are Unknown and are excluded from totals, with the reason shown. Payment status is computed separately from `amountPaid` and `balance`. Conflicts between the two are flagged.
- Balance verification policy:
  - `payments_reconciled` (the default): JobTread's amount paid must match the synced payments.
  - `jobtread_balance`: an admin explicitly accepts JobTread's document balance.
- Overdue means issued, past due plus grace days, and a verified balance > 0. Otherwise it's blank.
- Reconciliation takes invoiced, paid and outstanding from the document amounts. Payments only verify them and are never added on top. Missing data gives `null` totals marked partial or incomplete, never zeros.
- Payments backfill: Data settings → Financial data has a dry run (JobTread's count and estimated pages). Confirming turns payments on and queues **one** chunked, checkpointed sync. Nothing runs automatically.
- Project Manager audit: completeness by PM and by phase, values outside the JobTread options, multi-person values, open jobs with no PM, and defects by class.
- Sync writes tolerate migration 084 not being applied: unknown columns are stripped and the write is retried.

## 4. Phase 2 — PP#

`bi_pp_config` controls:

- **classification**: `document_field`, `name_pattern` or `number_pattern` (the first capture group is the PP#).
- **milestonePct**: a field or a pattern.
- **link**: `document_field_task_id`, or `task_name_pattern` with `{pp}`, matched within the same job ID (milestone groups or all tasks), or `manual_only`.
- **autoAcceptUnique**: whether unique matches skip approval.

The preview lists matched, ambiguous and unmatched invoices. "Record suggested links" stores suggestions and never overwrites approved, rejected or manual decisions. Manual links must point to a task on the invoice's own job.

The drill path is Project → PP# milestone → Invoice → Payments (`/api/reports/financial/drill`, `reports_project_financials`). Each level is on only when its join is verified.

## 5. Phase 3 — snapshots

`bi_snapshot_settings`: off by default; Monday 07:00 America/Los_Angeles, all configurable.

- The 2-minute job sweep captures the period once it's due. A unique `(period_start, calc_version)` run row stops duplicates.
- Collection is prospective: no period that started before snapshots were turned on is captured.
- `bi_snapshots` rejects UPDATE and DELETE (trigger).
- Each row stores period, metric, dimensions, value, completeness, source sync time and calc version (`fin-1`).
- Metrics: invoiced, paid, outstanding, overdue (total and count), issued count, outstanding by PM, forecast completion per open job, and late milestones.
- `compareLatestWeeks` answers "what changed since last Monday". It explains when there's no history, gaps between weeks, and calc-version changes. The kill switch is `BAXTER_SNAPSHOTS=off`.

## 6. Phase 4 — alerts

`bi_alert_rules` (all disabled by default) supports overdue invoice, forecast slip, forecast improvement, high risk and full recovery.

- High risk is a list of admin conditions. Full recovery means the job no longer meets a watched rule. A rule can't be enabled until its settings and recipients are complete.
- Financial rules suppress any subject without a verified balance.
- Dedupe keys are unique (`bi_alert_events.dedupe_key`). Repeats only refresh `last_seen_at`.
- Deliveries: in-app is delivered to the inbox. Slack is used only if `SLACK_BOT_TOKEN` is set and the rule names a channel; otherwise it's recorded as skipped. Retries back off exponentially (5 attempts).
- Audit trail: `bi_alert_audit`. Acknowledge, resolve and reopen use `/api/reports/alerts`.
- The sweep runs hourly at most. The kill switch is `BAXTER_ALERTS=off`.

## 7. Phase 5 — Data settings and Dexter

Data settings → **Financial data** (`/reports/settings/financial`) has:

- readiness per area (ready / partially configured / incomplete source data / requires mapping / sync disabled / unsupported / requires migration) with where to fix each one
- totals with their completeness reasons
- historical diagnostics, with a disclaimer that they don't certify completeness
- status mapping, balance policy and grace days
- payments backfill
- PM completeness
- PP# config, preview and approvals
- snapshots
- alert rules

Dexter tools are enabled through the seed marker "System: Dexter financial reporting tools": `reports_financial_readiness`, `reports_invoices`, `reports_project_financials`, `reports_week_compare`, `reports_alerts` and `reports_pm_completeness`. Dexter also gets responsibility 11, new examples and new keywords. Financial figures require financial access.

## 8. Manual test steps (after applying 084 in a non-production environment first)

1. Apply `supabase/migrations/084_financial_reporting.sql`. Open Reports → Data settings → Financial data and confirm no "requires migration" states remain.
2. Run a documents sync (Data settings → Sync). Check `jt_sync_entities.dropped_fields` for `documents`. Any attribute listed there is unsupported by the grant.
3. Map every raw status in Status mapping and save. Confirm invoice lifecycle values in a new report on the "Financial documents (invoices)" source.
4. Click "Preview payments backfill". If JobTread reports > 0, confirm the backfill and watch it in Sync. Then check that invoices show "Verified against payments" or "Payments don't match JobTread".
5. Turn on the Tasks dataset if it's off and sync it. Build a tasks report grouped by `sem:project_manager`.
6. Enter a PP# config, click Preview, review ambiguous and unmatched invoices, record suggestions, approve a few, then open `/api/reports/financial/drill?jobId=…`.
7. Turn snapshots on. On the next scheduled Monday, check `bi_snapshot_runs`. A week later, ask Dexter "what changed since last Monday?".
8. Create a disabled overdue rule, enable it with in-app recipients, click "Evaluate now", and check the inbox, acknowledge/resolve, and `bi_alert_audit`. Don't configure Slack until finance approves the channel.
9. Ask Dexter: "Which invoices are overdue?", "Outstanding by project manager?", "Show PP# milestones for <job>". Confirm it calls incomplete data incomplete and points to the right setting.

## 9. Open questions for Maxx

1. Which JobTread invoice statuses mean Issued, Paid and Voided (for example, does `approved` mean issued)?
2. Should Baxter accept JobTread's document balance as verified while payments aren't recorded in JobTread, or wait for payment records?
3. How is a PP# invoice identified: a naming convention on the invoice name or number, or a JobTread field? What's the exact format (for example "PP#3")?
4. How does a PP# invoice tie to the schedule: a milestone group named the same way, or something else? Can one milestone have several invoices?
5. Where does the milestone % live?
6. What grace period should apply before an invoice is called overdue?
7. Definitions for high risk and full recovery (thresholds), and who should receive each alert (roles or people)? Should any go to Slack, and which channel?
8. Snapshot day, time and timezone (default Monday 07:00 Pacific)?
9. Are payments recorded in JobTread today, or only elsewhere? (JobTread reported 0 on 2026-10-22.)
10. Jobs without a PM (386 of 449 per Dexter’s 2026-11-02 report): should they be filled in JobTread (for example closed or test jobs), or excluded from PM reports?
