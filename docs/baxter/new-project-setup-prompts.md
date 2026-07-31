# Baxter — New Project Setup Initiative

**Date:** July 31, 2026 · Automates project kickoff when a $500 Feasibility Package signs in GoHighLevel.

Manual process being automated: (1) append next project number + customer info to the Master Project Log tab of the master charter spreadsheet; (2) copy the `L00-00001 Master Project Folder` template in Drive `02 Projects`, rename to `<project-number> <last-name>`; (3) copy the Master Project Charter spreadsheet, rename to `<last-name> Project Charter`, move into the new folder; (4) create Slack channel `<project-number>-<last-name>`; (5) invite the standing member list (admin-editable; test mode invites only jackson.bridges@actonadu.com); (6) post kickoff message with Drive + Charter links and "Setting up BuilderTrend now."

Out of scope: BuilderTrend setup itself; auto-trigger from GHL payment webhook (future — human confirm stays in the loop).

Plan: 3 prompts.

1. Foundation + web trigger + GHL confirm + settings + dry-run (no external writes) — below.
2. Google execution (write scopes, sheet append, recursive folder copy, charter copy/move, resumable steps).
3. Slack execution (channel create, invites, kickoff message) + `/new-project` slash command modal.

Open questions before Prompt 2/3 (defaults in parentheses): private vs public channels (private); delete the Master Project Log tab from the charter copy (delete); sales rep source (GHL assigned user, editable on confirm); year-rollover numbering `L01-27001` (yes; number editable on confirm regardless).

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

1. **Migration `0XX_project_setup.sql`:**
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
