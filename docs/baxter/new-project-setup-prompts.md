# Baxter — New Project Setup Initiative

**Date:** July 31, 2026 · Automates project kickoff when a $500 Feasibility Package signs in GoHighLevel.

Manual process being automated: (1) append next project number + customer info to the Master Project Log tab of the master charter spreadsheet; (2) copy the `L00-00001 Master Project Folder` template in Drive `02 Projects`, rename to `<project-number> <last-name>`; (3) copy the Master Project Charter spreadsheet, rename to `<last-name> Project Charter`, move into the new folder; (4) create Slack channel `<project-number>-<last-name>`; (5) invite the standing member list (admin-editable; test mode invites only [jackson.bridges@actonadu.com](mailto:jackson.bridges@actonadu.com)); (6) post kickoff message with Drive + Charter links and "Setting up BuilderTrend now."

Out of scope: BuilderTrend setup itself; auto-trigger from GHL payment webhook (future — human confirm stays in the loop).

Plan: 3 prompts.

1. Foundation + web trigger + GHL confirm + settings + dry-run (no external writes) — below.
2. Google execution (write scopes, sheet append, recursive folder copy, charter copy/move, resumable steps).
3. Slack execution (channel create, invites, kickoff message) + `/new-project` slash command modal.

Decisions (answered July 31, 2026): **public** Slack channels; **keep** the Master Project Log tab in charter copies; sales rep from GHL assigned user, confirmed on screen; numbering is `<prefix>-<YY><seq>` with year rollover (January 2027 → `L01-27001`).

Status: Prompt 1 shipped (migration `031_project_setup.sql`, dry-run runner, `/projects/setup`, `/admin/project-setup`). Slack app scopes already include `channels:manage`, `channels:write.invites`, `users:read.email` — Prompt 3 needs no scope changes. Google Cloud APIs are sufficient; Prompt 2 upgrades OAuth scopes + one-time reconnect.

---

## Prompt 1 — Foundation: settings, workflow engine, GHL confirm flow, dry-run

You are working in the Acton ADU Baxter repo (Next.js App Router + Supabase + Vercel). Read `AGENTS.md` first and follow it. Inspect and reuse the existing architecture — extend, don't rebuild:

- `src/lib/jobs/` (`types.ts`, `queue.ts`, `process.ts`) — the Supabase-backed job queue with a typed `JOB_TYPES` union and dispatch switch in `processJob()`. New background work is a new job type here, not a new queue.
- `src/lib/connectors/ghl/` — `resources/contacts.ts` (`searchContacts` — remember `pageLimit`, never `limit`, on `POST /contacts/search`), `entity-graph.ts`, `present.ts`, `reference-data.ts` (assigned-user name hydration). Reuse for customer search and the confirm card.
- `src/lib/connectors/google/` — read-only Drive/Sheets access as `baxter@actonadu.com`. Scopes today are `drive.readonly` / `spreadsheets.readonly`; that is sufficient for THIS prompt (reading the Master Project Log to compute the next number). Do NOT add write scopes yet — that is Prompt 2.
- Admin page conventions: `/admin/baxter/governance`, `/admin/connectors/ghl`, `/admin/knowledge/settings`. App page conventions: `/reports/new` flow and its client components.
- `supabase/migrations/` — use the next unused migration number (check the folder; `021` is the highest as of this writing).
- Auth/roles: `new_user` / `salesperson` / `admin` in `profiles`; RLS patterns in existing migrations.

### Goal

Build the foundation for automated new-project setup: an admin-configurable settings model, a resumable multi-step workflow engine on the existing job queue, and a web UI where a salesperson or admin searches GoHighLevel for the customer, confirms the details, and launches a run. In this prompt the run executes in **dry-run mode only**: it computes and records everything (real next project number read from the real Master Project Log, folder name, charter name, channel name, member list) but performs zero external mutations. Prompts 2 and 3 will replace the dry-run stubs with real Google and Slack executors; design the step framework so they slot in without rework.

### Build

1. **Migration** `0XX_project_setup.sql`**:**

- `project_setup_settings` — singleton row: `member_emails jsonb` (default: the full standing list below), `test_mode boolean` default `true`, `test_member_emails jsonb` default `["jackson.bridges@actonadu.com"]`, `template_folder_id text`, `projects_parent_folder_id text`, `master_charter_spreadsheet_id text`, `master_log_tab_name text` default `"Master Project Log"`, `updated_by`, `updated_at`. Seed the IDs: template folder `1AJ6Czh9rJB04bJhNhChCl8E2AvCSFDIJ`, projects parent `150O10sPk_V2guH_Tqrx1AKNJyqsom0dv`, master charter spreadsheet `1_REzrzFc7vREVxqceI47soA4HWa3u-H9Y961UeQ6u6k`. Standing member list: ally.moin, aws.jabir, bryan.moser, connor.rainey, jackson.bridges, james.parks, jessee.bayze, jesse.soares, kevin.lee, mark.nichols, maxx.kimbler, milan.romic, rebecca.ralston, stanley.acton, tony.radovich, zac.yeager — all `@actonadu.com`.
- `project_setup_runs` — id, `status` (`draft|confirmed|running|complete|failed|cancelled`), `dry_run boolean`, `initiated_by` (profiles FK), `trigger_channel` (`web|slack`), `ghl_contact_id`, `contact_snapshot_json` (name, first/last, email, phone, address, city, zip, assigned user), `sales_rep text`, `project_number text`, `project_last_name text`, derived names (`folder_name`, `charter_name`, `slack_channel_name`), `fp_paid_date date`, timestamps, `error`.
- `project_setup_steps` — run FK, `step_key`, `order_index`, `status` (`pending|running|complete|failed|skipped`), `output_json` (created IDs/links land here in later prompts), `error`, `started_at`, `finished_at`. Unique (run_id, step_key).
- Unique index on `project_setup_runs.project_number` where status not in (`failed`,`cancelled`) — two concurrent runs must never mint the same number.
- RLS: salesperson + admin can read runs; only admins update settings; writes go through the service role from server code, matching existing patterns.

2. **Workflow engine** `src/lib/project-setup/`:

- A step registry: ordered list of `{ key, title, execute(ctx) }`. Steps for this initiative (later prompts implement 2–6 for real): `allocate_project_number`, `append_master_log_row`, `copy_template_folder`, `copy_charter_spreadsheet`, `create_slack_channel`, `post_kickoff_message`.
- New `JOB_TYPES` entry `project_setup`; `processJob()` dispatches to a runner that executes steps in order, persists per-step status/output, stops on failure, and on retry **resumes from the first non-complete step** (idempotent by design — completed steps are never re-executed).
- In this prompt, `allocate_project_number` is real; steps 2–6 execute as recorded dry-run plans: each writes `output_json.planned` describing exactly what it would do (row values, folder name + destination, charter name, channel name, member emails per test mode) and completes. Gate real execution behind capability flags the later prompts will flip (e.g., `googleWritesEnabled()`, `slackProvisioningEnabled()` returning false today).

3. **Project number allocation** (`allocate_project_number`, real):

- Read column A of the configured Master Project Log tab via the existing read-only Sheets access; take the last non-empty value, validate format `^([A-Z]\d{2})-(\d{5})$`, increment the numeric part (`L01-26017` → `L01-26018`), record source-row evidence in `output_json`.
- If the run already carries a user-overridden `project_number` (from the confirm screen), validate format + uniqueness and use it.
- Fail with a clear, employee-readable error when the tab is unreadable or the last value doesn't parse — never guess.

4. **Web UI** — new page `/projects/setup` (link it from the dashboard, visible to salesperson + admin):

- Search box → GHL contact search results (name, email, phone, address) via a new API route reusing `searchContacts` + hydration; select a contact.
- Confirm card: full name, first/last, email, phone, street address, city, zip, jurisdiction (= city), sales rep (prefill from GHL assigned user when available, editable), FP paid date (default today, editable), computed next project number (fetched live, editable), and the derived preview: folder name `<number> <last-name>`, charter name `<last-name> Project Charter`, channel `<number-lowercase>-<lastname-lowercase>` (Slack rules: lowercase, digits, hyphens; strip other characters), member list that WOULD be invited (respecting test mode, clearly labeled "TEST MODE — only jackson.bridges will be invited" when on).
- "Begin project setup" → creates the run + steps, enqueues the `project_setup` job, redirects to a run status page `/projects/setup/[runId]` showing the live step checklist (poll like `/reports/[reportId]/processing` does). Dry-run completion states plainly that no external systems were touched and shows the recorded plan.

5. **Admin settings UI** — `/admin/project-setup`: edit member emails (add/remove rows, validated `@actonadu.com` format warning but not hard-blocked), toggle test mode, edit test member list, edit the three Google IDs and tab name. Show recent runs with status. Follow existing admin page conventions.
6. **Capabilities honesty:** update `src/lib/baxter-ai/governance/capabilities.ts` to mention project-setup assistance only as: "Prepare new-project setup runs (dry-run) from GoHighLevel customer records for human confirmation" — upgrade the wording in later prompts when real execution exists.
7. **Do not** in this prompt: request any new Google OAuth scopes, mutate anything in Drive/Sheets/Slack/GHL, or build the Slack slash command. Web trigger + dry-run only.

### Test

- Unit tests (Vitest, follow `tests/unit/ghl-crm-ux.test.ts` / `prompt5b-slack-production.test.ts` patterns): project-number parsing/increment/validation (normal, malformed last cell, user override, uniqueness conflict); derived-name generation including Slack-name sanitization (apostrophes, spaces, unicode, long names); step runner resume-from-failure semantics and idempotency; test-mode member resolution; settings validation; the GHL search API route with mocked connector.
- Run `npm run format && npm run lint && npm run typecheck && npm run test` and fix what you broke.

### Report manual setup steps

End your reply with a checklist of manual steps: run the new migration in Supabase; verify the three seeded Google IDs in `/admin/project-setup`; confirm the Google connector (read-only) can read the Master Project Log tab (use the dry-run to verify the computed next number matches reality); leave test mode ON. Note explicitly that Prompt 2 will require upgrading Google OAuth scopes (`drive`, `spreadsheets`) and a one-time admin reconnect, and Prompt 3 will require new Slack scopes (`users:read.email` + `channels:manage` or `groups:write`) and an app reinstall — do not implement those yet. Update `docs/baxter-roadmap.md` and start `docs/project-setup.md` documenting the workflow and settings.

---

## Prompt 2 — Google execution: write scopes, sheet append, folder copy, charter copy

You are working in the Acton ADU Baxter repo (Next.js App Router + Supabase + Vercel). Read `AGENTS.md` first and follow it. Prompt 1 of this initiative is merged: migration `031_project_setup.sql`, the resumable step runner in `src/lib/project-setup/` (steps: `allocate_project_number` real; `append_master_log_row`, `copy_template_folder`, `copy_charter_spreadsheet`, `create_slack_channel`, `post_kickoff_message` as dry-run plans behind `googleWritesEnabled()` / `slackProvisioningEnabled()` gates), `/projects/setup` + `/projects/setup/[runId]`, and `/admin/project-setup`. Inspect all of it before writing code, plus:

- `src/lib/connectors/google/` — `oauth-config.ts` (scope list + granted-scope validation), `credentials/` (workspace OAuth, domain-wide delegation), `connections.ts` (`granted_scopes` storage), the existing Drive/Sheets read clients, reconnect endpoint `/api/admin/connectors/google/reconnect`, and the connector health/diagnostics surfaces.
- `src/lib/project-setup/` — implement inside the existing step contract; do not restructure the runner.
- `docs/google-workspace-oauth-setup.md` — update it for the new scopes.

### Goal

Make the three Google steps real. After this prompt, a confirmed run appends the row to the Master Project Log, recursively copies the template folder to `<number> <last-name>` under `02 Projects`, copies the master charter spreadsheet to `<last-name> Project Charter` inside that folder, and records links — resumable after any partial failure, with zero duplicate side effects on retry. Slack steps stay dry-run (Prompt 3).

Decisions already made — honor them: keep ALL tabs in the charter copy including "Master Project Log" (do not delete tabs); public Slack channels later (not this prompt); project numbering is `<prefix>-<YY><seq>`.

### Build

1. **OAuth scope upgrade:** replace `drive.readonly` with `https://www.googleapis.com/auth/drive` and `spreadsheets.readonly` with `https://www.googleapis.com/auth/spreadsheets` in the OAuth scope list and in the domain-wide-delegation scope list; keep `documents.readonly`. Update the granted-scope validator so read features accept either read-only or full scopes (a connection granted full scopes must not be reported as missing read scopes). `googleWritesEnabled()` now returns true iff the active connection's `granted_scopes` include both write scopes. Connector admin page and diagnostics show a clear read-only vs read-write status with a "Reconnect to enable writes" call to action reusing the existing reconnect flow.
2. **Drive/Sheets write helpers** in `src/lib/connectors/google/` (typed, minimal, reused by all steps): `appendSheetRow` (spreadsheets.values.append with `valueInputOption=USER_ENTERED`), `readSheetColumn`, `createFolder`, `copyFile` (files.copy with target name + parent), `listChildren` (files.list with full pagination), `findChildByName`. Every Drive call passes `supportsAllDrives=true` (and `includeItemsFromAllDrives=true` on lists) so template/parent locations work on Shared Drives and My Drive alike. Add bounded retry with backoff on 429/5xx (small helper; the folder copy makes many calls). Permission errors must surface as employee-readable step errors naming the connected account (e.g., "[baxter@actonadu.com](mailto:baxter@actonadu.com) lacks edit access to the 02 Projects folder") — never a raw Google error blob.
3. `append_master_log_row` **(real):** idempotency first — read column A of the configured tab; if the run's `project_number` already exists there, mark the step complete with `output_json.alreadyPresent=true` (resume case). Otherwise append one row, columns A–I exactly: A project number, B prospect last name, C sales rep, D FP paid date (format matching the sheet's existing date style), E customer full name from GHL, F street address, G city, H zip, I jurisdiction (= city). Record the appended range in `output_json`.
4. `copy_template_folder` **(real):** Drive has no folder-copy API — walk the template folder tree (`listChildren`, recursive, with pagination) and mirror it: create the destination folder `<number> <last-name>` under the projects parent, recreate subfolders, `copyFile` each file into place. Idempotent resume: if a destination folder with that exact name already exists under the parent, reuse it and copy only missing items (match by name within each folder level) — but if it exists and belongs to no prior attempt of THIS run (no step output recorded and the folder is non-empty with unexpected content), fail loudly rather than merging into someone's folder. Skip Drive shortcuts (record them in `output_json.skipped`). After copying, verify: recursively count folders and files in source vs destination and record both counts in `output_json.verification`; mismatch = step failure with the diff listed. Record destination folder id + `webViewLink`.
5. `copy_charter_spreadsheet` **(real):** idempotency — if a file named `<last-name> Project Charter` already exists in the destination folder, record it and complete. Otherwise `copyFile` the master charter spreadsheet with the new name directly into the project folder. Keep every tab as-is. Record file id + `webViewLink`.
6. **Number allocation year rollover:** update `allocate_project_number` — parse the last value as `<prefix>-<YY><seq>` (e.g., `L01` + `26` + `017`). If `YY` matches the two-digit year of the run's FP paid date, increment `seq`; if the run's year is newer, propose `<prefix>-<newYY>001`. Keep the existing format validation, user override, and uniqueness paths.
7. **Run page + lifecycle:** `/projects/setup/[runId]` renders real step outputs — clickable Drive folder and Charter links when complete, verification counts, readable errors. Add a **Retry** button (admin + initiator) on failed runs that re-enqueues the job; the runner already resumes from the first non-complete step. The confirm screen keeps an explicit "Dry run (plan only, no changes)" checkbox — checked and disabled when `googleWritesEnabled()` is false, unchecked by default once writes are enabled.
8. **Capabilities honesty:** when `googleWritesEnabled()` is true, update the capabilities wording to reflect real Google-side project setup (sheet row, folder, charter) with Slack provisioning still pending; keep the dry-run wording otherwise.
9. **Do not** in this prompt: implement Slack channel creation/invites/messages, the `/new-project` slash command, or any GHL writes. If a new migration is needed (e.g., a column you find missing), number it after the current highest in `supabase/migrations/`.

### Test

- Unit tests with mocked Drive/Sheets clients: scope validator (read-only conn, read-write conn, mixed); `googleWritesEnabled` gating; append idempotency (number already in column A) and column ordering A–I; recursive copy over a nested fixture tree (subfolders, files, a shortcut) including pagination; resume after partial copy (some files exist → only missing copied); verification mismatch → failure with diff; unexpected existing destination folder → loud failure; charter copy idempotency; year rollover (`L01-26017`+2026 → `L01-26018`; `L01-26017`+2027 → `L01-27001`); permission-error message mapping.
- Run `npm run format && npm run lint && npm run typecheck && npm run test` and fix what you broke.

### Report manual setup steps

End your reply with a checklist: (1) in Google Cloud Console → OAuth consent screen, confirm the app is **Internal** to the actonadu.com Workspace (full `drive` scope requires no restricted-scope verification for internal apps; if it is External, flag that as a decision) and add the two new scopes to the consent configuration if listed; (2) open `/admin/connectors/google` and **Reconnect** as `baxter@actonadu.com`, approving the new permissions; (3) in Google Drive, verify `baxter@actonadu.com` has **Editor** access to the `02 Projects` folder, the `L00-00001 Master Project Folder`, and the master charter spreadsheet — OAuth scopes don't grant file permissions; (4) verify the connector page now shows read-write; (5) run one LIVE test with a test contact, confirm the sheet row / folder tree / charter match the manual process, then manually delete the test row, folder, and charter (Baxter has no delete step by design); (6) leave test mode ON for Slack. Update `docs/project-setup.md`, `docs/google-workspace-oauth-setup.md`, and `docs/baxter-roadmap.md`.

---

## Prompt 3 — Slack execution, `/new-project` command, charter list row, live-test fixes

Prompt 2 shipped and passed a live Google test. Observed issues folded into this prompt: dry runs wrongly reserve project numbers; gated Slack steps display as "complete" in live runs. New requirements: append the new charter's link to the "Project Charter List" tab; exclude the Project Charter Master spreadsheet from the template folder copy. Full prompt text lives in the conversation/chat; summary of scope:

1. Dry runs never reserve project numbers (uniqueness applies to live runs only; adjust index/checks; no manual Supabase cleanup ever needed).
2. Template folder copy excludes the configured `master_charter_spreadsheet_id` (it lives inside the template folder); verification counts account for the exclusion.
3. New step `append_charter_list_row` — appends a hyperlinked charter row to the "Project Charter List" tab (tab name in settings; row format isolated in one function).
4. Real Slack provisioning: public channel `<number>-<lastname>`, invites resolved via `users.lookupByEmail` (test mode → jackson only; non-workspace emails are warnings, not failures), kickoff message with Drive folder link, charter link, "Setting up BuilderTrend now." Scopes already granted; no reinstall.
5. Step-status semantics: planned-but-not-executed steps show `planned`, never `complete`; runner syncs step rows for resumed older runs.
6. `/new-project` slash command → modal (search GHL → pick contact → confirm details) → creates the same run; completion/failure notified back to the initiator; interactions endpoint implements `view_submission` / block actions.
7. Capabilities wording updated to full end-to-end project setup.

Manual steps after: create the `/new-project` slash command in the Slack app config pointing at `/api/slack/commands/new-project`; enable Interactivity with URL `/api/slack/interactions`; verify Project Charter List row format on a live test; flip test mode off when ready to invite the full standing list.

Status: Prompt 3 shipped (migration `032_project_setup_slack.sql`). Web app flow confirmed fully working end to end — do not modify it. Live-test bug found: after searching for a customer in the `/new-project` modal, Slack shows "We had some trouble connecting. Try again?" — classic symptom of a `view_submission` response missing Slack's 3-second budget (GHL search + serverless cold start) or an unhandled exception producing a non-conforming response. Fix below (Prompt 3b) targets Slack interactivity code only.

---

## Prompt 3b — Fix `/new-project` modal: view_submission response reliability

You are working in the Acton ADU Baxter repo (Next.js App Router + Supabase + Vercel). Read `AGENTS.md` first. The web app `/projects/setup` flow is fully live-tested and working — **do not modify anything under `src/app/(app)`/`/projects/setup`, `src/lib/project-setup/` step execution, or the Google-side code.** This prompt only touches Slack interactivity for `/new-project`.

### Symptom

In Slack, `/new-project` opens the modal correctly. Typing a customer name and submitting the search step returns Slack's generic client-side error "We had some trouble connecting. Try again?" — clicking "Try again" repeats the same failure. This is Slack's standard message when a `view_submission` HTTP response is late, non-200, or not a valid `{ response_action, view }` / empty-body ack. It is not a GHL or business-logic error message from our own code (those would render inside the modal, not as this generic banner).

### Diagnose first

1. Read the current implementation of `src/app/api/slack/interactions/route.ts` and whatever handles `view_submission` for the `/new-project` flow (search step, contact-selection step, confirm step) end to end.
2. Confirm exactly how the interaction payload is parsed. Slack sends interactive payloads as `application/x-www-form-urlencoded` with a single field named `payload` containing a JSON string — NOT a raw JSON body. Verify `verifySlackRequest` gets the true raw body for signature checking, and that the handler correctly extracts and `JSON.parse`s the `payload` form field afterward (not `request.json()` directly). This is the single most common cause of this exact failure and must be checked first.
3. Check whether the search step calls GoHighLevel (or does other I/O) synchronously in the code path that must return the `view_submission` HTTP response. Time it under realistic conditions (cold start included). If it can plausibly exceed ~2.5 seconds, that is the root cause even if parsing is correct.
4. Check Vercel logs filtered specifically to `POST /api/slack/interactions` and `POST /api/slack/commands/new-project` around the time of a reproduction (the `Invalid cron secret` error you may see in the same log window is from the unrelated `/api/internal/process-jobs` cron endpoint — ignore it for this diagnosis; note it separately below). Look for thrown exceptions, timeouts, or a response that isn't valid JSON.
5. Confirm every code path through the `view_submission` handler — including error paths (GHL search throws, zero results, GHL misconfigured) — returns a valid Slack response and never lets an exception escape unhandled to a 500 or a hung response.

### Fix

Implement whichever of these applies based on your diagnosis (implement all that are actually broken; do not restructure working parts):

1. **Payload parsing:** if the handler isn't correctly extracting the URL-encoded `payload` field, fix it. Add a small shared parser used by both the interactions route and (if needed) the command route, with a unit test covering the real Slack form-encoded shape.
2. **3-second budget for the search step:** do not perform the GHL search synchronously inside the `view_submission` response path if it risks exceeding the budget. Use the pattern already established elsewhere in this repo for async Slack work (the job queue + `views.update` after processing, mirroring how `slack_baxter_reply` jobs work): respond to the `view_submission` immediately — either an empty 200 ack, or `response_action: "update"` with a lightweight "Searching…" view — then run the GHL search in a background job and call `views.update` (using the `view_id`/`hash` from the original payload) with the real results once it completes. Apply the same non-blocking pattern to any other step in this modal flow that performs I/O (run creation/enqueue on final submit), even if today's timing happens to work, so this class of bug can't recur under load or cold starts.
3. **Exhaustive error handling:** wrap the entire `view_submission` handler so any thrown error (GHL down, malformed contact data, Supabase error) still returns a valid, on-time Slack response — either `response_action: "errors"` with a field-level message the user can read in the modal ("Couldn't search GoHighLevel right now — try again"), or a pushed `views.update` showing the error, matching the async pattern above. The generic "trouble connecting" banner must never be the failure mode for a handled error.
4. **Guided flow polish:** since responses may now arrive asynchronously via `views.update`, make sure the user always sees a clear state — searching, results found, no results (with a way to search again, not a dead end), confirm screen, submitting, success/failure — so the experience matches "guided through the whole setup" even with the async round trip.

### Test

- Unit tests: form-encoded payload parsing (real Slack shapes, `view_submission`, `block_actions`); the search step under a simulated slow GHL response confirming the HTTP response to Slack still returns well within budget while the real update happens via `views.update`; every handled-error path returns a valid Slack response shape; happy path (search → select → confirm → submit) still creates the run correctly and matches the already-working web app run creation logic (reuse it, don't duplicate it).
- Run `npm run format && npm run lint && npm run typecheck && npm run test` and fix what you broke. Confirm you have not changed any file under the web app project-setup UI or the Google-side step execution.

### Report manual setup steps

End your reply with a checklist: redeploy; run `/new-project` in Slack end to end (search with a slow-ish GHL response if you can simulate it, confirm no "trouble connecting" error, confirm the modal updates through every state to a completed run); confirm the web app flow is untouched and still works. Separately, flag as a follow-up (not fixed in this prompt unless trivial): Vercel logs show `Invalid cron secret` on `/api/internal/process-jobs` — verify the `CRON_SECRET` env var in Vercel matches what the Vercel Cron configuration (or any external pinger) sends; this is unrelated to the Slack fix but is a real misconfiguration worth resolving separately.

---

## Prompt 3 follow-up — Fix Slack slash command "trouble connecting" error

Status (Aug 2026): Web flow (`/projects/setup`) confirmed working end to end. Slack `/new-project` modal fails after the customer-name search step with Slack's native "We had some trouble connecting. Try again?" — this is Slack's client-side message for an interaction (`view_submission` / `block_actions`) that didn't receive a valid response within Slack's ~3 second window, or received a malformed one. Prime suspect: the GHL contact search runs synchronously inside the `view_submission` handler and Slack times the modal update out before it returns. Do not touch `/projects/setup` or any shared step-runner/Google code — Slack-surface fix only.

---

## Prompt 3 — Slack execution, `/new-project` command, charter list, fixes

Status going in: Prompt 2 shipped and live-verified (sheet append, recursive folder copy with verification, charter copy). Defects found in live testing: (a) dry-run runs reserve project numbers via the uniqueness check even though they never write to the sheet; (b) gated Slack steps display "complete" when they only recorded a plan. New requirements: append each new charter to the "Project Charter List" tab of the Project Charter Master (admin-configurable spreadsheet id — must be verified in settings); exclude the Project Charter Master spreadsheet (`1_REzrzFc7vREVxqceI47soA4HWa3u-H9Y961UeQ6u6k`) from template folder copies. Slack scopes (`channels:manage`, `channels:write.invites`, `users:read.email`) are already installed on the app. Full prompt text delivered in chat July 31, 2026; mirrors the structure of Prompts 1–2 (inspect → goal → build → test → report manual steps).
