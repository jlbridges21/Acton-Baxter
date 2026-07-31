# Project setup

Automated new-project kickoff after a Feasibility Package signs in GoHighLevel.

## Status

| Prompt                            | Status                   |
| --------------------------------- | ------------------------ |
| 1 — Foundation + dry-run          | Done (migration **031**) |
| 2 — Google writes                 | Done                     |
| 3 — Slack channel + slash command | Done (migration **032**) |

## What works

- Admin settings at `/admin/project-setup` (member lists, test mode, Google IDs, Master Log + Charter List tab names)
- Web flow at `/projects/setup` → confirm → `/projects/setup/[runId]`
- Slack `/new-project` modal: search GHL → pick contact → confirm → live run + DM outcome
- Durable `project_setup` job with resumable steps
- **Real** Google steps when write scopes are connected and dry-run is unchecked:
  1. Allocate next project number (year rollover)
  2. Append Master Project Log row (A–I), idempotent if number already present
  3. Recursively copy template folder under `02 Projects` (excludes Project Charter Master by file id)
  4. Copy master charter into the new folder (all tabs retained)
  5. Append Project Charter List hyperlink row
- **Real** Slack steps when `ENABLE_SLACK_INTEGRATION` + bot token are set: 6. Create public channel + invite members (test mode → test member emails only) 7. Post kickoff message with Drive/charter links

## Dry runs do not reserve numbers

Only **live** (`dry_run = false`) runs in non-failed/non-cancelled status reserve a project number (partial unique index + `isProjectNumberInUse`). A dry run’s recorded number is informational (“would be L01-26020”).

## Step status honesty

Gated / dry-run plan-only steps use status **`planned`** (“Planned — not executed”). **`complete`** is reserved for steps that actually executed or verified an idempotent already-done state. Older runs missing newer step keys are backfilled as `pending` on resume.

## Google write scopes

Reconnect at `/admin/connectors/google` so `granted_scopes` include:

- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`

`googleWritesEnabled()` is true when those scopes are present (or SA/DWD mode). Confirm screen **Dry run** checkbox is checked+disabled until writes are enabled.

## Slack provisioning

`slackProvisioningEnabled()` is true when `ENABLE_SLACK_INTEGRATION` is on and `SLACK_BOT_TOKEN` is set. Scopes already on the live app: `channels:manage`, `channels:write.invites`, `users:read.email`, `chat:write`, `commands`.

## Project numbers

Format `<prefix>-<YY><seq>` e.g. `L01-26017`. FP paid year rollover → `<prefix>-<newYY>001`.

## Manual setup (Prompt 3)

1. Run migration **032** in Supabase
2. Slack app: create `/new-project` → `https://acton-baxter.vercel.app/api/slack/commands/new-project`; confirm Interactivity ON → `…/api/slack/interactions` (no new scopes / no reinstall)
3. With test mode ON: one live web run + one `/new-project` Slack run; verify channel (jackson only), kickoff links, Charter List row, folder without Project Charter Master; then manually clean up
4. Confirm Charter List row format; adjust `buildCharterListRowValues` if needed
5. When ready for real projects: turn test mode OFF in `/admin/project-setup`
