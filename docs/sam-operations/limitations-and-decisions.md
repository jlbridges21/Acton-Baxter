# Known limitations and open decisions

## Missing leadership decisions

All of these are tracked in **Sam Operations → Setup**, which shows live progress. Nothing below is assumed.

- **Organization:** confirm the legal entities' exact names; the CEO and COO accounts; HR administrators; the head of finance; workflow owners; and the launch date.
- **Documents:**
  - the official onboarding and offboarding checklists (the starter workflows are unofficial until then);
  - required employee documents;
  - approved contract templates;
  - Drive destinations;
  - naming conventions;
  - retention policy.
- **Access and approvals:**
  - whether employees see only their own records (implemented default: yes);
  - manager exceptions;
  - the approval boundary;
  - the standing-approval policy (implemented default: per-action approval);
  - autonomy (implemented default: none).
- **Integrations:**
  - BambooHR API access and writable fields;
  - Google sending identity and permissions;
  - the BetterTeams process;
  - the DocuSign account (including whether MSP applies);
  - JobTread timecard usage;
  - Slack identity links for the CEO and COO.
- **Timecards:** cutoff, reminder schedule, escalation, and what finance receives.
- **Surveys:** anonymity; the meaning of "specific survey detail" (implemented default: aggregated only); aggregation; owners.
- **Legal and insurance:**
  - the subcontractor boundary (implemented default: review only);
  - the contract review owner;
  - counsel escalation;
  - the insurance inventory and owners.
- **Operations:** volumes, budget, hosting, and support.

## Known limitations

- **BetterTeams and BambooHR surveys:** no public APIs were found, so these are manual, approval-controlled tasks.
- **Timecards:** JobTread has no time entries. Checks record "no data", and per-employee completeness rules aren't defined. Reminders "through Baxter" are Slack direct messages from the Baxter bot.
- **Gmail and Calendar:** need additional Google permissions. Until then, approved emails become manual tasks, and interview times are recorded by hand.
- **Interview rescheduling and cancellation:** there is no dedicated flow yet. Request a new time (new approval) and record changes by hand. Calendar events created by Sam aren't updated automatically.
- **DocuSign:** status is polled, but the completed PDF isn't yet automatically archived into Drive.
- **Contract review:** a deterministic first pass. It finds and quotes dates and common clauses and lists questions. It does not judge legal risk; that stays with the review owner or counsel.
- **Drive filing:** documents are stored privately in Baxter first and copied to Drive only by an approved _File in Drive_ step.
- **Retention:** the `retention_until` field exists, but no automatic deletion runs until the retention policy is decided.
- **App administrators:** can configure but can't see all HR records or approve. This is intentional; HR administrators and leadership see HR records.
- **Existing Phase 1 onboarding tracker** (`/ai/onboarding`): still works and is separate. The new engine supersedes it for new workflows.

## Decision log (implementation choices)

| Decision                                                                  | Reason                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Reuse the shared `ai_approval_requests` queue, adding payload binding     | One place to approve; payload hashes stop approval reuse                               |
| Leadership comes only from confirmed Setup decisions                      | The brief names roles, not people. App admins can bootstrap once and can never approve |
| One studio page with grouped tabs                                         | Part 23 forbids 19 sidebar links                                                       |
| Fixed step-type registry, with no expressions or scripts in configuration | Prevents code injection through workflow configuration                                 |
| Test mode simulates approvals and never calls external systems            | Lets administrators practise safely with synthetic data                                |
| Survey raw responses are never stored                                     | The safest default until leadership defines the detail policy                          |
| Date reminders only for verified contract dates                           | Prevents wrong reminders from unverified extracted dates                               |
| BambooHR updates and DocuSign sends can never be autonomous               | Highest-risk external writes                                                           |
| Starter workflows seeded as unofficial drafts                             | The brief says to use leadership's checklists; Sam must not present guesses as policy  |
