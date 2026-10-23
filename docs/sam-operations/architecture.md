# Architecture

Sam Operations lives inside the existing Baxter app. It reuses Baxter's sign-in and roles, the AI Workforce (agents, approvals, audit log, Knowledge Hub), the `report_jobs` queue and its cron, the Google Workspace connection, and the Slack bot. It adds no new services.

```
Browser (/ai/operations) ──► /api/ops (GET state, POST validated commands)
                               /api/ops/instances/[id], /api/ops/templates/[id]
                               /api/ops/documents (upload), /api/ops/documents/[id] (download)
        │
        ▼
src/lib/ops/commands.ts ─ authorization + dispatch (zod discriminated union)
        │
        ├─ org.ts           leadership decisions, legal entities, OpsAccess (who can do what)
        ├─ engine.ts        templates/versions, instances, step state machine, sweep
        ├─ actions.ts       approval-bound actions (propose → approve → execute once)
        ├─ registers.ts     people, contracts, templates, insurance, surveys, vacancies, interviews, timecards, autonomy
        ├─ documents.ts     private storage (bucket ops-documents), versions, access checks
        ├─ integrations.ts  BambooHR, Google (Drive/Gmail/Calendar), DocuSign, Slack, JobTread adapters
        ├─ rules.ts         pure logic (reminder thresholds, survey aggregation, free slots, contract review)
        ├─ starters.ts      unofficial starter workflow drafts
        └─ brief-knowledge.ts  leadership-brief documents for the Knowledge Hub
Sam (agent) ──► src/lib/agents/ops-tools.ts (ops_status, ops_workflow_detail, ops_request_workflow, ops_contracts, ops_propose_message)
Cron /api/internal/process-jobs ──► sam_operations_sweep job (every ~15 min) ──► engine.sweepOperations()
Approvals (/ai/approvals or the Approvals tab) ──► decideApproval ──► ops hooks in actions.ts
```

## Database (migration `071_sam_operations.sql`)

All tables have row-level security enabled with **no browser policies**. Only server routes (service role) read or write them.

| Table                                              | Purpose                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops_entities`                                     | Legal entities (Acton Construction, Acton ADU). Unconfirmed until leadership confirms them                                                           |
| `ops_decisions`                                    | The leadership decisions checklist (status, value, who confirmed it, and when)                                                                       |
| `ops_autonomy_rules`                               | Leadership-enabled autonomy per action type, optionally per workflow or entity, with who enabled or revoked it                                       |
| `ops_people`                                       | Employees and candidates that workflows are about. BambooHR stays authoritative; a `test_record` flag marks synthetic people                         |
| `ops_workflow_templates` / `ops_workflow_versions` | Versioned definitions (`draft → published → superseded`), with an `official` flag                                                                    |
| `ops_workflow_instances`                           | A running workflow pinned to one version (`pending_approval → active ⇄ paused → completed / cancelled`). Live or test mode. A unique idempotency key |
| `ops_workflow_steps`                               | Persisted step state, assignee, due date, reminders, evidence, override reason                                                                       |
| `ops_actions`                                      | Every consequential effect: payload, SHA-256 hash, status, attempts, result, unique idempotency key                                                  |
| `ai_approval_requests` (+3 columns)                | `payload_hash`, `ops_action_id`, and `invalidated_at` bind each approval to one exact action                                                         |
| `ops_documents` + bucket `ops-documents`           | Private files (25 MB, PDF/DOCX/PNG/JPG/TXT, checked by magic bytes). Each version keeps `supersedes_id`                                              |
| `ops_contract_templates`, `ops_contracts`          | Template versions (`draft / approved / inactive`), the contract register, and the stored review                                                      |
| `ops_insurance_policies`                           | The policy inventory                                                                                                                                 |
| `ops_reminders`                                    | Raised reminders, unique per item and threshold, so the same reminder is never raised twice                                                          |
| `ops_surveys`                                      | Survey definitions and aggregated results only. Raw responses are never stored                                                                       |
| `ops_vacancies`, `ops_interviews`                  | Recruitment publication and scheduling                                                                                                               |
| `ops_timecard_checks`                              | Weekly completeness checks (unique per period)                                                                                                       |
| `ops_integration_settings`                         | Non-secret settings: Drive folder ids, the BambooHR field allowlist, last test results                                                               |
| `report_jobs.job_type`                             | Adds `sam_operations_sweep` (the existing list is kept exactly)                                                                                      |

The migration is additive: it creates new tables and adds nullable columns. It drops nothing except the `report_jobs_job_type_check` constraint, which it recreates with the full existing list plus the new type.

## Workflow engine

A **definition** is configuration only: up to 80 steps, each drawn from a fixed registry of step types with implemented handlers. It never contains code.

| Step type                                                              | Behavior                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Task, Checklist, Collect information, Upload document, Verify document | A person completes it. The requirements (fields, ticks, file, note) are enforced on the server                           |
| Access request                                                         | **COO only**, and a completion note is required                                                                          |
| Finance handoff                                                        | Head of finance (or leadership) only                                                                                     |
| Leadership approval                                                    | Becomes an `approve_step` action for the CEO or COO                                                                      |
| Communication / Escalate                                               | Sam renders `{{merge_fields}}`. Missing values block the step with a message. Proposed as `send_email` or `notify_slack` |
| System update                                                          | Proposed as `bamboohr_update`, `drive_file`, or `docusign_send`                                                          |
| Wait until                                                             | Scheduled; the sweep wakes it                                                                                            |
| Milestone                                                              | Completes automatically when its dependencies are done                                                                   |

**Validation** (`validateDefinition`) rejects:

- duplicate or missing step ids, and dependency loops;
- access steps not assigned to the COO;
- finance steps not assigned to finance;
- approvals not from the CEO or COO;
- messages without text;
- system steps without an action;
- due dates without a date input to anchor them.

**State machine:** `blocked → ready → (in_progress | awaiting_approval | waiting) → completed`, with `skipped` (a leadership override with a recorded reason), `failed`, and `cancelled`. `advanceInstance` is idempotent and uses a short `processing_until` lease so concurrent callers don't double-advance.

**Versioning:** saving edits the current draft, or creates version _n+1_. Publishing supersedes the previous published version. Rollback copies an old version forward as a new draft; history is never rewritten. A running instance stays on its version until someone previews and applies a migration. Completed steps keep their history, new steps are added, and removed open steps are cancelled with a reason.

## Approval model

1. Every effect is an `ops_actions` row. `proposeAction` hashes `{actionType, payload, mode}`.
   - Re-proposing the same payload returns the same action.
   - A different payload for the same logical item **supersedes** the old action and **invalidates** its approval.
2. A shared approval request (`ai_approval_requests`, `ops.*` type) shows the target, effect, evidence, data changes, and the exact payload.
3. `decideApproval` accepts only the **confirmed CEO or COO** (from Setup). It refuses invalidated requests, mismatched hashes, and edits.
4. `executeAction` re-checks right before acting:
   - the approval is still approved and not invalidated;
   - the hash still matches;
   - the decider is still the CEO or COO;
   - any autonomy rule is still enabled.

   It then claims the action atomically (`approved → executing`), so one action runs at most once.

5. **Results:**
   - `succeeded`;
   - `manual_required` (no integration; the action carries exact instructions, and a person confirms with evidence);
   - retryable errors go back to `approved`, up to 5 attempts;
   - non-retryable errors become `failed`, with an actionable message and a Retry button.
6. **Test mode** never calls external systems. Administrators can simulate approval only for test actions.
7. **Autonomy** (Setup → Autonomy) is off by default. Only the CEO or COO can enable it, per action type and optionally per workflow or entity. Revocation takes effect immediately, including for queued actions. BambooHR updates and signature requests can never be autonomous.

## Permission model

`getOpsAccess(requester)` uses only **verified** identity (a web session or a mapped Slack user):

| Capability                                                                                                                 | Who                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Approve Sam's actions; enable autonomy; skip steps; cancel workflows                                                       | The confirmed CEO or COO                                                                                    |
| Change sensitive decisions (leadership accounts, HR admins, finance owner, access and approval policy, BambooHR allowlist) | The CEO or COO. **Before** any leadership account is confirmed, an app admin can bootstrap them             |
| Configure workflows, registers, and documents; see all HR records                                                          | CEO, COO, HR administrators. App admins can configure but **cannot** see all HR records or approve anything |
| Complete a step                                                                                                            | The assigned person, or the role that owns it. Access steps: COO only. Finance steps: finance or leadership |
| Everyone else                                                                                                              | Only their own tasks, the workflows that involve them, and their own documents                              |

Sam's tools derive the same access from the requester, so an employee asking through Baxter never gets CEO/COO-level data.
