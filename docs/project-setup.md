# Project setup (Prompt 1 — dry-run foundation)

Automated new-project kickoff after a Feasibility Package signs in GoHighLevel.

## What works today

- Admin settings at `/admin/project-setup` (standing Slack invite list, test mode, Google IDs, Master Project Log tab name)
- Employee/admin web flow at `/projects/setup`: search GHL → confirm → launch run
- Durable `project_setup` job on the existing `report_jobs` queue
- Resumable multi-step runner (`src/lib/project-setup/`)
- **Real** next project number from Master Project Log column A (Google Sheets **read-only**)
- Steps 2–6 complete as **dry-run plans** in `output_json.planned` — zero Drive / Sheets / Slack / GHL mutations

## Settings (`project_setup_settings`)

Singleton row (`id = 1`):

| Field                           | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `member_emails`                 | Standing Slack invite list                                        |
| `test_mode`                     | When true, only `test_member_emails` are invited (default **ON**) |
| `test_member_emails`            | Default `jackson.bridges@actonadu.com`                            |
| `template_folder_id`            | Drive template folder                                             |
| `projects_parent_folder_id`     | `02 Projects` parent                                              |
| `master_charter_spreadsheet_id` | Spreadsheet containing Master Project Log                         |
| `master_log_tab_name`           | Default `Master Project Log`                                      |

## Workflow steps

1. `allocate_project_number` — read column A, parse `^([A-Z]\d{2})-(\d{5})$`, increment; or validate user override + uniqueness
2. `append_master_log_row` — dry-run plan (Prompt 2)
3. `copy_template_folder` — dry-run plan (Prompt 2)
4. `copy_charter_spreadsheet` — dry-run plan (Prompt 2)
5. `create_slack_channel` — dry-run plan with invite list (Prompt 3)
6. `post_kickoff_message` — dry-run plan (Prompt 3)

Capability gates: `googleWritesEnabled()` and `slackProvisioningEnabled()` return `false` until later prompts.

On failure, retry resumes from the first non-`complete` step (completed steps never re-execute).

## Derived names

- Folder: `<project-number> <LastName>`
- Charter: `<LastName> Project Charter`
- Slack: lowercase / digits / hyphens from `<number>-<lastname>`

## Unique project numbers

Partial unique index on `project_setup_runs.project_number` where status is not `failed` or `cancelled`.

## Manual setup

1. Apply migration `031_project_setup.sql` in Supabase
2. Open `/admin/project-setup` and verify the three seeded Google IDs
3. Confirm Google connector (read-only) can read the Master Project Log tab via a dry-run
4. Leave **test mode ON**

## Coming next

- **Prompt 2:** Google write scopes (`drive`, `spreadsheets`) + one-time admin reconnect; real sheet append + folder/charter copy
- **Prompt 3:** Slack scopes (`users:read.email` + `channels:manage` or `groups:write`) + app reinstall; channel create, invites, kickoff; `/new-project` slash command
