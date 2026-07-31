# Project setup

Automated new-project kickoff after a Feasibility Package signs in GoHighLevel.

## Status

| Prompt                            | Status                   |
| --------------------------------- | ------------------------ |
| 1 — Foundation + dry-run          | Done (migration **031**) |
| 2 — Google writes                 | Done (this doc)          |
| 3 — Slack channel + slash command | Pending                  |

## What works today

- Admin settings at `/admin/project-setup`
- Web flow at `/projects/setup` → confirm → `/projects/setup/[runId]`
- Durable `project_setup` job with resumable steps
- **Real** next project number from Master Project Log (with year rollover)
- **Real** Google steps when write scopes are connected and dry-run is unchecked:
  1. Append Master Project Log row (A–I), idempotent if number already present
  2. Recursively copy template folder under `02 Projects`
  3. Copy master charter into the new folder (all tabs retained)
- Slack steps still record dry-run plans only

## Google write scopes

Reconnect at `/admin/connectors/google` so `granted_scopes` include:

- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`

(`documents.readonly` remains.) Full write scopes also satisfy Knowledge sync read features.

`googleWritesEnabled()` is true when those scopes are present (or SA/DWD mode is used). The confirm screen’s **Dry run (plan only, no changes)** checkbox is checked+disabled until writes are enabled; unchecked by default once they are.

## Project numbers

Format `<prefix>-<YY><seq>` e.g. `L01-26017`. If the run’s FP paid year matches `YY`, increment `seq`. If the paid year is newer, propose `<prefix>-<newYY>001`. Confirm-screen overrides still win after format + uniqueness checks.

## Folder copy resume

Progress (destination folder id, copied counts) is persisted on the step’s `output_json` during the copy. Retry reuses that folder and copies only missing names. An unexpected same-named folder under `02 Projects` with no progress from this run fails loudly.

## Manual setup (Prompt 2)

1. Confirm OAuth consent is **Internal** to actonadu.com Workspace; add full Drive + Sheets scopes if the consent screen lists them
2. Reconnect Google as `baxter@actonadu.com` and approve writes
3. Grant Editor on `02 Projects`, the template folder, and the master charter spreadsheet
4. Confirm the connector page shows **read-write**
5. Run one live test; manually delete the test row/folder/charter afterward
6. Leave Slack **test mode ON**

## Coming next (Prompt 3)

Slack channel create/invite/kickoff + `/new-project` slash command; requires Slack scopes `users:read.email` and `channels:manage` (or `groups:write`) plus app reinstall.
