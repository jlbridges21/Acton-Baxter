# Staff lifecycle (Sam, HR lifecycle coordinator)

Sam coordinates every hire and departure through the leadership **Acton ADU Staff Lifecycle Checklist** (Oct 28, 2026). Sam tracks the tasks, owners, deadlines, and evidence. People complete, verify, and authorize the work. Sam never decides.

- Where: **Sam Operations → Workflows → Staff lifecycle** (`/ai/operations?tab=lifecycle`)
- Mapping from document to workflow: [mapping.md](mapping.md). It is generated from the code, and a test fails if it drifts.
- Migration: `supabase/migrations/082_hr_lifecycle.sql` (**not applied**)

## What it is built on

The lifecycle layer extends Sam Operations (migration 071) instead of running a parallel workflow system.

| Lifecycle concept                     | Built on                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-boarding, onboarding, offboarding | Three versioned ops workflow templates (`lifecycle-preboarding`, `lifecycle-onboarding`, `lifecycle-offboarding`), seeded as **drafts** |
| One checkbox                          | One workflow step, with `lifecycle` metadata: exact wording, part, section, position, tags, citations, conditions, timing, owner        |
| A case for one employee               | An ops workflow instance pinned to the published version. It waits for a CEO/COO approval before any task starts                        |
| Task statuses                         | The ops step state machine, plus `external_verification` and `not_applicable`                                                           |
| Offboarding authorization             | An `approval` step (CEO/COO, bound to its exact payload) that every offboarding task depends on                                         |
| Access, payroll, and finance tasks    | `access_request` steps (COO only, evidence required) and `finance_handoff` steps (head of finance)                                      |
| Reminders                             | The existing cron → `sam_operations_sweep` → `sweepLifecycle()`, deduplicated through `ops_reminders`                                   |
| Source document                       | Knowledge Hub document (Sam, `hr-policies`), plus a version row in `ops_lifecycle_sources`                                              |
| Sam's behaviour                       | Sam's registry config (new version through the seed upgrade) and three read-only tools                                                  |
| Baxter delegation                     | Sam's configured keywords and examples (registry-driven, no hardcoded routing)                                                          |

Code is in `src/lib/hr-lifecycle/`:

- `catalog.ts`: the 105 checkboxes plus the recurring calendar, sources, and flags.
- `rules.ts`: conditions, dates, the final-pay rule, and statuses.
- `plan.ts`: the planner the wizard uses.
- `templates.ts`: catalog to definitions, edits, and compliance diffs.
- `source-document.ts`: the .docx parser and reconciliation.
- `service.ts`: the server operations.
- `reminders.ts`: the scheduled sweep.
- `commands.ts`: the HTTP layer.

Routes:

- `/api/ops/lifecycle`: GET state and POST commands.
- `/api/ops/lifecycle/cases/[id]`: one case.
- `/api/ops/lifecycle/source`: .docx import.

The UI is in `src/components/ops/lifecycle*.tsx`. Sam's tools are in `src/lib/agents/lifecycle-tools.ts`.

## Using it

1. **Setup** (Sam Operations → Setup → HR lifecycle):
   - Confirm the company headcount. Only the CEO or COO can do this, because it switches CFRA, COBRA vs Cal-COBRA, harassment training, and Cal-WARN.
   - Name the tech ops manager.
   - Record the counsel or payroll-provider timing review.
   - Confirm that the company owns the social and Google accounts.
2. **Templates & settings**: review the three draft templates, then have the CEO or COO publish them. Optionally import the original .docx; it is stored in the Knowledge Hub with version metadata.
3. **Start a case**: choose the employee record, roles, facts, and dates, then review the generated checklist:
   - deadlines and owners;
   - legal flags with their verification state;
   - licensed seats;
   - missing information and missing approvals;
   - draft communications.

   Then request CEO/COO approval to start.

4. **Dashboard**: shows the employee overview, the management view, and reminders. Open a case for the chronological task view. Each task shows:
   - its exact wording, source, and citations;
   - owner and due date;
   - why it is included or excluded;
   - dependencies, approvals, evidence, notes, and history.
5. **Compliance & verification**: has the recurring calendar and the legal verification register.
6. **Access register**: holds platform seats and costs (entered with a source, never estimated) and every grant and removal, with its approver.

### Task statuses

| Status                | Meaning                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed             | Done, with the evidence the task requires. Legal and access tasks always need evidence                                                            |
| Awaiting action       | Ready for its owner and not yet due                                                                                                               |
| Overdue               | Ready, but past its due date                                                                                                                      |
| Awaiting approval     | Waiting for a CEO/COO decision, such as the offboarding authorization                                                                             |
| External verification | Done in another system (BambooHR, the payroll provider, an admin console) and waiting for someone to confirm it with evidence                     |
| N/A                   | Doesn't apply. Either excluded when the case started (the reason is recorded), or marked N/A by a person with a reason. Legal tasks: CEO/COO only |
| Blocked               | Waiting on an earlier task                                                                                                                        |

Allowed changes are enforced on the server (`canTransition`). Every change is written to the task's history (`ops_lifecycle_events`).

## Safety rules (enforced in code, covered by `tests/unit/hr-lifecycle.test.ts`)

- **No automatic effects.** Nothing deactivates accounts, changes payroll, or sends messages. Access tasks are COO-only human tasks, finance tasks go to the head of finance, and communications are drafts for HR to edit and send themselves.
- **Starting a case** always needs a CEO/COO approval. Synthetic (test) employee records can only start test cases.
- **Offboarding** begins with an explicit CEO/COO authorization task, and every other task depends on it. Immediate or involuntary separations also need a written reason of at least 20 characters.
- **Roles and access.** A job title only _suggests_ roles; role tasks stay off until HR confirms the roles. Privileged platform roles (admin or owner) can only be recorded with the CEO or COO as the named approver and a written reason.
- **Unknown facts never silently remove a legal item.** For example, an unknown headcount keeps the item in and flags it as missing information.
- **Legal deadlines are unverified** until a named reviewer records an official https source:
  - accepted sources: DIR, EDD, CRD, DHCS, Cal/OSHA regulations, the Legislature, USCIS, DOL, IRS, eCFR, or a similar government source;
  - discrepancies are recorded next to the original wording, which is kept unchanged;
  - editing a legal item always routes publishing through a recorded CEO/COO review, even for leadership, and returns its verification to "unverified".
- **Template edits** create new draft versions, with rollback by copying forward. Running cases keep their version, and communication-template edits never rewrite drafts already in a case.
- **Reminders** come from the scheduled sweep, with no model calls. There is one row per item and threshold (due soon, 1 day overdue, 7 days overdue, plus 30 days ahead for compliance items).
  - Reminders are in-app by default.
  - Slack reminders stay off until the CEO or COO enables them and a recipient is configured.
  - Even then, each Slack reminder is an approval request.

## Privacy

- Every lifecycle table has RLS on with no browser policies. Server routes authorize every request (`getOpsAccess`).
- Who can see what:
  - Leadership and HR admins see cases.
  - App admins can configure templates but cannot open HR records.
  - Other people see only the cases with tasks assigned to them.
- Case labels, approval titles, reminders, and audit summaries use a case reference (`Pre-boarding case LC-3F2A9B`), never a name. The person register's audit entry no longer includes the name either.
- `ops_workflow_instances.lifecycle` stores facts and dates only (roles, exempt status, headcount, dates), not names or contacts.
- Sam's lifecycle tools return case references, task titles, and statuses only, with no names, evidence notes, or documents. The plan-preview tool takes no employee record. The AI Office shows agent activity only.
- Identity documents (I-9) are never uploaded; evidence records where the document is kept.

## What is not operational yet

- **Migration 082 is not applied.** Until it is, the lifecycle tab and sweep will fail against Supabase (they work in the in-memory test store).
- **The templates are drafts.** No case can start until the CEO or COO publishes them.
- **Legal deadlines are all "unverified."** The register is seeded, but no reviewer has checked anything. Counsel or the payroll provider still needs to review the timing items, as the document itself says.
- **The headcount, tech ops manager, and other leadership decisions are open.** Items that depend on them are flagged in every case.
- **Slack reminders are off.** Even when enabled, each one needs approval. The Slack onboarding automation and Baxter intro sequence in the checklist are not automated; they are draft communications.
- **BambooHR stays read-only.** "Marked complete in BambooHR" steps are done by a person and confirmed through external verification.
- **No seat counts or prices are recorded.** The licensed software gate shows "not recorded" until an admin enters actual figures with their source.

## Open questions found in the document

These are flagged on the items themselves:

- "Verify all four logins" lists only three platforms.
- "Delete or archive the Google account after the retention window" is ambiguous: does it mean the 30-day suspension or the 3-year retention?
- The EITC notice's twice-yearly EDD dates are not given. Occurrences have no due date until a reviewer enters the verified schedule.
- The stay-or-pay item cites no statute.
- I-9 business days skip weekends only, not holidays.
- "Log every grant in the access register" sits under marketing, but the register covers every role.
