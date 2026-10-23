# Testing results

All tests use **synthetic data** and in-memory stores. External systems are replaced by a fake HTTP layer that records calls. No real employee, BambooHR record, email, invitation, vacancy, or signature request was touched.

## Automated tests (22 Oct 2026)

| Suite                                                                       | Result                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/unit/sam-operations.test.ts`                                         | **24 / 24 passed**                                                                                                                                                                                                                                                                                                             |
| Full unit suite (`npm run test`)                                            | 2,194 passed. 45 failed, all in 6 files that already failed before this work: `inventory-ui`, `project-status-filter`, `site-inspection-response-race`, `site-inspection-runner-ui`, `dashboard-tools`, and `dashboard-tools-view`. These fail because `localStorage` isn't available in the test environment. No new failures |
| E2E `tests/e2e/sam-operations.spec.ts` and `tests/e2e/ai-workspace.spec.ts` | **10 / 10 passed**                                                                                                                                                                                                                                                                                                             |
| `npm run format`, `lint` (0 errors), `typecheck`, `build`                   | Passed                                                                                                                                                                                                                                                                                                                         |

### Acceptance scenarios covered (`sam-operations.test.ts`)

1. **Leadership authority.** An app admin can bootstrap the CEO once, and then only leadership can change sensitive settings. Confirming leadership grants them Sam access.
2. **Silence is not approval.** Repeated sweeps leave a request pending. Admins, HR, employees, and finance can't approve. Approvals can't be edited.
3. **Onboarding, live.**
   - Required fields are enforced.
   - Access steps are COO-only (the CEO is refused) and need evidence. Payroll is finance-only.
   - The welcome email is rendered from collected values and waits for approval. With Gmail not granted, it falls back to manual, and a person records completion.
   - Document upload is enforced, and the workflow completes.
4. **Test mode** makes zero external calls, and simulated approval is refused on live actions.
5. **BambooHR.**
   - A rejected change makes zero calls.
   - An approved allowlisted change makes one POST plus a read-back.
   - A blocked field (`payRate`) fails with no call.
6. **Payload binding.** A duplicate proposal returns the same action. A changed proposal supersedes the old one, and the old approval can't be used.
7. **Idempotency.** A duplicate workflow start returns the same instance. Three concurrent executions make one POST.
8. **Failures.**
   - A 503 keeps the action queued, and the sweep retries it successfully (2 attempts).
   - A 401 fails with an actionable message.
9. **Surveys.** Groups below the minimum are suppressed, no individual answers are returned, and launch needs approval.
10. **Timecards.** "No data" is recorded honestly, checks are idempotent per period, and no payroll actions exist.
11. **Contracts.**
    - Templates generate only once approved, and every merge field is required.
    - The review quotes clauses and carries the disclaimer.
    - A signature request is approval-bound and deduplicated, with no call while DocuSign is unconnected.
12. **Reminders.** Unverified dates get none. Verified dates get the tightest threshold, raised exactly once (`contract:30d`, `insurance:7d`). Reminders themselves need approval.
13. **Privacy.**
    - Employees can't see or upload other people's documents, see contracts, or see other people's workflows.
    - Unverified requesters get nothing, even with a claimed admin role.
14. **Recruitment.** An approved BetterTeams listing becomes a manual task, then is published with a link. Interview slots avoid busy times and weekends.
15. **Autonomy.**
    - Only leadership can enable it, and never for BambooHR updates or signature requests.
    - Revoking it restores approval, and a queued auto-approved action is cancelled.
16. **Workflow safety and versioning.**
    - Validation catches access steps not assigned to the COO, finance steps not routed to finance, approvals not from leadership, and loops.
    - All 8 starters validate.
    - HR publish requests need the CEO.
    - Running workflows stay pinned; migration is previewed, then applied.
    - Unpublished workflows can't start.
17. **Contract text is data.** Embedded "ignore all previous instructions" text is quoted, never followed.
18. **Sam configuration.**
    - Fresh installs ship the operations tools.
    - Upgrading a Phase 1 config keeps admin edits (a custom tone), adds tools, replaces untouched text, and passes the instruction-policy checker.
    - Sam's tools scope data to the requester, and employees are refused.

## Manual walkthrough (sandbox dev server)

Performed in the in-app browser against the in-memory sandbox:

1. Setup: confirmed the CEO account.
2. Opened the onboarding starter in the visual editor (Build and Preview) and published it.
3. Added a synthetic person and started a **test** onboarding. Starting it twice returned the same workflow.
4. Simulated the start approval. Completed "Confirm new-hire details" and checked that the CEO is refused on the COO access step (403).
5. Saw the welcome email waiting in Approvals with the rendered text.

Two defects were found and fixed during the walkthrough:

- The Start dialog's idempotency key exceeded the 120-character limit; it is now hashed.
- Google status lookups were slow in sandbox mode.

Screenshots:

- [Setup](images/setup-decisions.jpg)
- [Workflow editor](images/workflow-editor.jpg)
- [Workflow detail](images/workflow-detail.jpg)
- [Approvals](images/approvals.jpg)

## How to demonstrate

1. Run the app in sandbox mode (`.claude/launch.json` → `baxter-ai-sandbox`, or `E2E_TEST_AUTH_BYPASS=true ENABLE_MOCK_RESEARCH=true npx next dev -p 3100`), and open `/ai/operations`.
2. Setup: confirm the CEO account (you), then Setup → People → add a person marked **Synthetic test record**.
3. Library & editor: open **Employee onboarding**, then Preview, then Publish.
4. Onboarding: select **Start a workflow**, choose **Test run**, then **Create test run**.
5. Approvals: select **Simulate approval (test)**, then open the workflow and complete steps.
6. Run `npx vitest run tests/unit/sam-operations.test.ts` for the automated scenarios.
