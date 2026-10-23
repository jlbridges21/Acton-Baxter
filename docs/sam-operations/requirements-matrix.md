# Requirements matrix

Sources: **LB** is the leadership brief ("Sam AI Agent Project Brief", 22 Oct 2026, draft). **IB** is the implementation brief (Parts 1–27).

How to read the status column:

- **Built**: implemented and covered by automated tests with synthetic data.
- **Built, blocked**: the software is ready, but it can't run live until the named input exists.
- **Manual**: no supported integration exists, so Sam creates an approval-controlled manual task instead.
- **Open**: needs a leadership decision.

## Users, approvals, and access

| Requirement                                                                             | Source | Status                                                   | Where                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The CEO and COO talk to Sam directly                                                    | LB     | Built, blocked: needs the CEO and COO confirmed in Setup | Confirming the accounts grants Sam access policies (`syncLeadershipSamAccess`). In Slack, addressing "Sam, …" routes explicitly when the Slack account is mapped |
| Other employees use Baxter; Baxter can assign Sam work, not the reverse                 | LB     | Built                                                    | Existing Baxter → Sam delegation; delegation guidelines and keywords updated                                                                                     |
| Either the CEO or the COO approves                                                      | LB     | Built                                                    | `handleOpsApprovalDecision` and `stillAuthorized`                                                                                                                |
| Every task approved before execution (initially)                                        | LB     | Built                                                    | `proposeAction`; autonomy is off by default                                                                                                                      |
| Silence or time never counts as approval                                                | LB, IB | Built (tested)                                           | No timeout path exists; the sweep never approves                                                                                                                 |
| An approval shows the action, recipient or record, supporting information, and effect   | LB     | Built                                                    | Approvals tab, "Show exact details"                                                                                                                              |
| A material change needs a new approval                                                  | LB     | Built (tested)                                           | SHA-256 payload binding; changed requests supersede the old one and invalidate its approval                                                                      |
| Autonomy is configurable by workflow and action type, explicit, recorded, and revocable | LB, IB | Built (tested)                                           | Setup → Autonomy; BambooHR changes and signature requests are never autonomous                                                                                   |
| The COO controls access, and Sam never grants access                                    | LB     | Built (tested)                                           | `access_request` steps are COO-only, with evidence required                                                                                                      |
| Restrict HR and contract data by user and role                                          | LB     | Built (tested)                                           | `getOpsAccess`, `requireOps`, document checks                                                                                                                    |
| Employee requests never inherit CEO/COO permissions                                     | LB     | Built (tested)                                           | Verified identity only; unverified requesters get no access                                                                                                      |
| Whether employees see only their own records; manager exceptions                        | LB     | Open                                                     | Setup: `record_access` and `manager_exceptions`. The default is own records only                                                                                 |
| Audit trail of requests, approvals, changes, communications, and failures               | LB     | Built                                                    | `ai_audit_log` (ops.* actions), Activity tab                                                                                                                     |
| Retrieved documents are data, not instructions                                          | LB     | Built (tested)                                           | Contract review is deterministic; tools label records as untrusted                                                                                               |
| Credentials are stored securely, with least access                                      | LB     | Built                                                    | Environment variables only; the UI shows status, never secrets                                                                                                   |

## Workflows

| Requirement                                                                                | Source | Status         | Where                                                                        |
| ------------------------------------------------------------------------------------------ | ------ | -------------- | ---------------------------------------------------------------------------- |
| Reusable, versioned workflow engine (draft, validate, preview, publish, archive, rollback) | IB     | Built (tested) | `src/lib/ops/engine.ts`, Library & editor                                    |
| Running workflows keep their version; migration happens only after review                  | IB     | Built (tested) | `migrateInstance` previews, then applies                                     |
| Non-technical editing, with no code in configuration                                       | IB     | Built          | Visual editor with a fixed registry of step types                            |
| Durable execution (survives restarts; retries)                                             | IB     | Built (tested) | Persisted state, a cron sweep every 15 minutes, and attempt limits           |
| Duplicate events don't duplicate writes, invitations, or signatures                        | LB     | Built (tested) | Idempotency keys, an atomic `approved → executing` claim, unique constraints |
| Failed integrations show actionable errors, keep state, and retry safely                   | LB     | Built (tested) | `IntegrationError` (retryable or not), Approvals → Needs attention, Retry    |

### Onboarding and offboarding

| Requirement                                                             | Source | Status                                                                              |
| ----------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Start from leadership checklists, revised with the CEO or COO           | LB     | Built, blocked: starter drafts exist but are unofficial until the checklists arrive |
| Start only after an approved employee event                             | LB     | Built: a start needs CEO/COO approval and a stated reason                           |
| Report missing inputs and overdue steps                                 | LB     | Built: the step shows the problem; reminders and escalations                        |
| File documents in the designated Drive, tied to the employee and entity | LB     | Built, blocked: Drive folders not designated                                        |
| Update approved BambooHR fields                                         | LB     | Built, blocked: BambooHR credentials and field allowlist                            |
| DocuSign signatures                                                     | LB     | Built, blocked: DocuSign credentials                                                |
| COO-owned access tasks                                                  | LB     | Built (tested)                                                                      |
| Finance steps go to the head of finance                                 | LB     | Built (tested)                                                                      |

### Recruitment, records, surveys, timecards

| Requirement                                                                                          | Source | Status                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Publish approved vacancies through BetterTeams                                                       | LB     | Manual: no public API found. The approved exact text becomes a manual task, and someone records the link                          |
| Schedule interviews for human-selected candidates without conflicts                                  | LB     | Built, blocked: needs Google Calendar permission. Conflicts are re-checked before booking; times can be entered by hand meanwhile |
| Rescheduling and cancellation under the same controls                                                | LB     | Partial: new bookings are approval-controlled. Reschedule or cancel for now by requesting a new time and recording it             |
| BambooHR is authoritative; changes are proposed with source information and approved first           | LB     | Built (tested)                                                                                                                    |
| Run surveys and report aggregates to leadership                                                      | LB     | Manual delivery: no BambooHR survey API found. Aggregation and suppression are built (tested)                                     |
| Survey detail only when requested and permitted                                                      | LB     | Built (results stored aggregated only), Open: meaning of "specific detail"                                                        |
| Check JobTread timecards against the weekly deadline; remind through Baxter; escalate before payroll | LB     | Built, blocked: JobTread has 0 time entries, and the cutoff is not confirmed. Checks record "no data" honestly                    |
| Never edit hours, calculate pay, or approve payroll                                                  | LB     | Built: no such action exists                                                                                                      |

### Contracts and insurance

| Requirement                                                                       | Source | Status                                                                                                             |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Approved templates in a restricted location; populate from approved data          | LB     | Built (tested): only CEO/COO-approved templates generate, and every merge field is required                        |
| Coordinate DocuSign and archive completed agreements                              | LB     | Built, blocked: DocuSign credentials. Status polling is built; archiving of the completed PDF is not yet automated |
| Track contract expirations and insurance renewals at agreed intervals             | LB     | Built (tested): verified dates only, deduplicated                                                                  |
| Review contracts: clauses, risks, improvements, questions, with source references | LB     | Built: a deterministic first pass with quotes, labelled not legal advice                                           |
| Review owner and counsel escalation                                               | LB     | Open                                                                                                               |
| Subcontractor contracts: review only                                              | LB     | Open: the default is "review only" as drafted                                                                      |
| Renewal tracking doesn't authorize purchases or payments                          | LB     | Built: premium payment is a finance step                                                                           |

## Implementation-brief deliverables

| Item                                                                               | Status                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Part 23: all 19 screens, as tabs not sidebar links                                 | Built. One "Sam Operations" workspace tab: Overview (leadership dashboard), My tasks, Approvals, Active workflows, Onboarding, Offboarding, Library & editor (with visual editor and versions), Documents, Recruitment & interviews, Surveys, Timecards, Contracts, Insurance, Integrations, Setup, Sam configuration, Activity. Workflow detail opens as a dialog |
| Part 24: documentation                                                             | This folder                                                                                                                                                                                                                                                                                                                                                        |
| Part 25: leadership decisions checklist and setup wizard                           | Built: Setup tab, with sections, progress, and per-decision editors                                                                                                                                                                                                                                                                                                |
| Sam's overview, instructions, delegation, tools, access, and Knowledge Hub updated | Built (tested upgrade): admin customizations are kept                                                                                                                                                                                                                                                                                                              |
