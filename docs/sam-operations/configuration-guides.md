# Configuration guides

Everything here is done in **AI Workspace → Sam Operations**. You need to be the CEO, the COO, or an HR administrator confirmed in **Setup**.

## Before anything else: Setup

1. **Setup → Leadership decisions → Organization.** Confirm the CEO's and COO's Baxter accounts. Until this is done, nothing can be approved. An app administrator can record these once; after that, only the CEO or COO can change them.
2. Confirm the HR administrators and the head of finance.
3. **Setup → Legal entities.** Check the exact legal names of Acton Construction and Acton ADU, and confirm them.
4. **Setup → People.** Add the people your workflows are about. Link each one to their BambooHR id and Baxter account. Tick _Synthetic test record_ for practice people.
5. **Integrations.** Enter Google Drive folder ids for each entity. Once BambooHR is connected, ask the CEO or COO to choose the fields Sam may update.

## Workflow editor basics

Open **Library & editor**, choose a workflow, and select **Open editor**.

- **Due dates count from:** the start date (onboarding), the last day (offboarding), a target date (renewals), or when the workflow starts.
- **Starting information:** fields people fill in when they start the workflow. Use their ids in messages, like `{{start_date}}`.
- **Steps:** add, reorder, duplicate, or delete steps. For each step, choose the kind, who does it, its due date (days before or after the anchor date), what it waits for, reminders, escalation to the CEO and COO, and whether a completion note is required.
- The footer lists problems as you edit. You can't publish until there are none.
- **Preview** shows the timeline. **Versions** shows history, changes since the published version, and _Restore as draft_.
- **Save draft**, then **Publish** (CEO or COO) or **Request publish** (HR administrators; the CEO or COO approves it in Approvals).
- Running workflows keep their version. To move one onto the new version, open it, choose **Review the changes**, then **Apply migration**.

## Onboarding

1. Open the **Employee onboarding** starter. It is an _unofficial draft_.
2. Replace its steps with Acton's official checklist (Setup decision "Official onboarding checklist"). For each task, record the owner, what it depends on, any approval needed, and the evidence required.
3. Keep **access steps** as _Access request (COO)_ and **payroll** as _Finance handoff_. The editor enforces both.
4. Use _Upload document_ for each required document, with a category such as `signed_offer_letter`. Add _System update → File a document in Google Drive_ to file it.
5. Publish. To use it: **Onboarding → Start a workflow**. Choose the person, the entity, and the start date, and describe the approved event (for example, "Offer accepted 10/20, confirmed by the COO").

## Offboarding

Same as onboarding, using the **Employee offboarding** starter, anchored on the last day.

- The first step is a leadership confirmation.
- Access removal belongs to the COO.
- Final pay belongs to finance.
- Recording the departure in BambooHR is a manual step, because termination and status fields are blocked from Sam on purpose.

## Recruitment

- **Recruitment & interviews → New listing.** Write the exact listing text, then select **Request publication**. After the CEO or COO approves, publish that exact text in BetterTeams (there is no API) and select **Record posting link**.
- **Schedule an interview.** Add the candidate (chosen by a person, never by Sam) and the interviewers.
  - **Find times** proposes conflict-free weekday slots, if Google Calendar access is granted.
  - **Request invitation** sends the invitation for approval, and conflicts are re-checked before booking.
  - Without Calendar access, record the agreed time by hand.

## Surveys

1. **Surveys → New survey.** Enter the title, audience, questions (rated 1–5), confidentiality, and minimum group size (at least 3; default 5).
2. **Request launch.** The CEO or COO approves.
3. Distribute the survey manually; there is no BambooHR survey API.
4. **Enter results.** Paste a CSV with a `group` column and one column per question, without names or emails. Sam keeps only the aggregates and hides any group smaller than the minimum.

## Timecards

- Leadership confirms the cutoff, reminder schedule, escalation policy, and what finance receives (Setup → Timecards). The weekly automatic check runs only after the cutoff is confirmed.
- JobTread has no time entries yet, so checks record **No data**. Use the **Weekly timecard follow-up** workflow to track manual follow-up and the handoff to finance.
- Sam never edits hours, calculates pay, or approves payroll.

## Contracts

- **Contract templates.** Paste the approved text with `{{merge_fields}}`, then **Request approval**. Only approved templates can generate contracts, and every field must be filled. Editing an approved template creates a new draft version.
- **Add contract.** Enter its dates, notice period, and reminder thresholds, and its owner. Then tick **Dates verified** after checking the dates against the signed copy. Reminders run only for verified dates.
- **Upload** the document, then select **Review** for a quoted first-pass review. It is not legal advice; route legal questions to counsel once leadership names the path.
- **Send for signature** creates an approval request for a DocuSign envelope. Duplicate requests reuse the same request.

## Insurance

**Insurance → Add policy.** Enter the coverage, insurer, entity, renewal owner, renewal or expiration date, and reminder thresholds (default 90, 60, 30, and 7 days). The owner gets each reminder. The CEO and COO are added at the final threshold and when a date passes. Premium payment is a finance step.
