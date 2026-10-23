# Final handover checklist

## Technical (developer)

- [ ] Get authorization, then apply migration `071_sam_operations.sql` to production.
- [ ] Deploy the app, and confirm `/ai/operations` loads for an administrator.
- [ ] Set the BambooHR environment variables, then run **Integrations → Test connection**.
- [ ] Re-consent Google with `gmail.send` and Calendar scopes (if leadership approves Sam sending and scheduling).
- [ ] Set the DocuSign environment variables and complete one-time consent (demo first, then production go-live).
- [ ] Link the CEO's and COO's Slack accounts (`slack_user_mappings`).
- [ ] Confirm the cron shows `samOperations` in its response and that `sam_operations_sweep` jobs complete.

## Leadership (CEO / COO)

- [ ] Confirm the CEO and COO accounts, HR administrators, head of finance, and legal entities (Setup).
- [ ] Provide the official onboarding and offboarding checklists. The HR administrator edits the starters to match, and the CEO or COO publishes them.
- [ ] Choose the BambooHR fields Sam may update.
- [ ] Designate the Drive folders for each entity.
- [ ] Load and approve the contract templates. Enter the insurance inventory and the policy owners.
- [ ] Decide the timecard cutoff, reminders, escalation, and what finance receives.
- [ ] Decide survey anonymity, detail access, and aggregation.
- [ ] Decide the subcontractor boundary, the contract review owner, and counsel escalation.
- [ ] Decide the approval boundary and the standing-approval policy. Leave autonomy off until comfortable.

## Pilot (days 33–40 of the plan)

- [ ] Run a **test** onboarding and offboarding end to end with synthetic people.
- [ ] Run one **live** low-risk action (for example, a Slack message to the CEO) and approve it.
- [ ] Approve one BambooHR update on a test employee, then verify it in BambooHR.
- [ ] Rehearse recovery: break a credential, watch the action fail with a clear message, fix it, and select **Retry**.
- [ ] Train the operational owners using the [user guides](user-guides.md).

## Acceptance (days 41–45)

- [ ] Check the 8 acceptance criteria in the brief against [testing results](testing.md) and the pilot evidence.
- [ ] Agree on monitoring, support, maintenance, and costs ([operations](operations.md)).
- [ ] Sign off.
