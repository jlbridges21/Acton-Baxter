# Google Drive Knowledge Manager

Baxter does **not** ingest every Drive file the connected account can see. Administrators explicitly select files and folders in `/admin/connectors/google`, preview them, then sync into the approved Knowledge Base.

## Authentication (Prompt 2)

**Preferred:** Google Workspace OAuth (`GOOGLE_AUTH_MODE=workspace_oauth`) as `baxter@actonadu.com`.

The Cloud service account is often **external** to Acton ADU and cannot join internal Shared Drives. Full setup: `docs/google-workspace-oauth-setup.md`.

| Variable                | Role                                                 |
| ----------------------- | ---------------------------------------------------- |
| Connected OAuth account | API caller for browse/sync when OAuth mode is active |
| `GOOGLE_CLIENT_EMAIL`   | Optional service-account fallback                    |

---

## Sharing model

1. Connect Google Workspace in Baxter.
2. Ensure `baxter@actonadu.com` can open the Acton Shared Drive in drive.google.com.
3. In Baxter, list Shared Drives → **Connect as root** → select files → sync.

## Shared Drive

1. Prefer OAuth (not SA membership).
2. Browse Shared Drives from the Google Workspace admin page.
3. Connect the drive or a folder as a Knowledge root (no manual ID paste required for the primary flow).

If the root folder metadata is visible but children fail to list, the connected account lacks folder permission — fix in Google Drive sharing for that Workspace user.

Google Drive remains **read-only**. Baxter never creates, edits, deletes, or changes sharing on Google files.

## Service account vs Workspace OAuth

| Identity                                     | Role                                         |
| -------------------------------------------- | -------------------------------------------- |
| Connected OAuth user (`baxter@actonadu.com`) | Preferred API caller for Acton Shared Drives |
| `GOOGLE_CLIENT_EMAIL`                        | Optional SA fallback for My Drive shares     |

See `docs/google-workspace-oauth-setup.md` for why the SA is rejected as external to Acton ADU.

## Required Google APIs

Enable in the Google Cloud project:

- Google Drive API
- Google Docs API
- Google Sheets API

## Least-privilege scopes

The connector mints tokens for read scopes only (Drive metadata/content read, Docs/Sheets read). Write scopes are not requested.

## Sharing a My Drive folder (service-account fallback)

1. Find `GOOGLE_CLIENT_EMAIL` in Vercel env (or Google Cloud → service accounts).
2. In Drive, share the folder with that email (Viewer is enough).
3. Copy the folder ID or full folder URL into **Add folder** (Advanced) in the admin UI.

For Acton Shared Drives, prefer Workspace OAuth instead of SA membership.

## Finding a folder ID / URL

- URL form: `https://drive.google.com/drive/folders/<FOLDER_ID>`
- Paste either the ID or the full URL — Baxter normalizes it (advanced path only).

## Selecting sources

### Individual file

Adds only that file to Baxter. Sync imports Docs/Sheets/text/markdown content. PDF and Word remain metadata-only until content extraction is implemented.

### Managed folder

Defaults:

- Recursive = on
- Include future supported files = on

Administrators can exclude specific child files or folders.

### Inherited selection

Files under a managed folder are included by the parent selection unless explicitly excluded. Avoid duplicate “direct file” selections for the same ID when a parent folder already covers them.

## Preview

**Preview selected** exports a bounded text sample (truncated with an indicator). Preview does **not** write Knowledge Base entries.

Sheets previews preserve tab names, headers, and row boundaries with safe row/cell caps.

## Manual sync

Use **Run sync now** on `/admin/connectors/google`.

- Requires an active admin session
- Does **not** require `CRON_SECRET`
- Uses `POST /api/admin/connectors/google/sync`
- Prevents overlapping syncs (`BAXTER_GOOGLE_SYNC_ALREADY_RUNNING`)

**Process pending job now** claims a queued `google_knowledge_sync` job without exposing the cron secret.

## Automatic sync / cron

Architecture:

1. Vercel Cron invokes `GET|POST /api/internal/process-jobs` on a fixed schedule (see `vercel.json`).
2. Auth: `Authorization: Bearer ${CRON_SECRET}` (or legacy `INTERNAL_CRON_SECRET`).
3. Job processor may enqueue Google sync when due based on `GOOGLE_SYNC_INTERVAL_MINUTES`.
4. Skips when `GOOGLE_SYNC_ENABLED=false`, when not due, or when a sync is already queued/running.

### Why opening `/api/internal/process-jobs` in a browser fails

Browsers do not send the Bearer cron secret. A 401 / “Invalid cron secret” response is **expected and correct**. Do not test cron by opening the URL normally. Use **Run sync now**.

### Hobby vs Pro

| Plan  | Typical cron                                                                  |
| ----- | ----------------------------------------------------------------------------- |
| Hobby | At most once per day — this repo ships `0 12 * * *`                           |
| Pro   | May use `*/15` or `*/30`; due logic still uses `GOOGLE_SYNC_INTERVAL_MINUTES` |

Do not present a three-hour interval as guaranteed on Hobby.

## Removing / restoring a source

**Remove from Baxter**:

- Stops future sync
- Archives the Google-backed Knowledge Base entry
- Never deletes the Google file
- Reselect later to restore synchronization

## Google-managed Knowledge Base entries

Entries show **Google Workspace managed**, link to the original Drive URL, and warn that content is controlled in Google. Prefer editing the Google file, then sync. Tags/category can remain editable in Baxter and are preserved across sync.

## Clickable sources

Baxter cites the stored `source_url` (original Google web view link). Opening the link requires the employee’s own Google permissions — Baxter does not grant new Drive access.

## Troubleshooting

| Symptom                      | Action                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| Auth failed                  | Check private key PEM newlines (`\n`), client email, clock |
| Root inaccessible            | Share folder/Shared Drive with service account             |
| APIs disabled                | Enable Drive/Docs/Sheets APIs on the GCP project           |
| Empty folder but files exist | Child share / Shared Drive member missing                  |
| Stale sync                   | Confirm cron secret + Hobby daily limit; use manual sync   |
| Browser cron 401             | Expected — use admin Run sync now                          |

## Safe key rotation

1. Create a new service-account key in GCP.
2. Update `GOOGLE_PRIVATE_KEY` / `GOOGLE_CLIENT_EMAIL` in Vercel.
3. Redeploy.
4. Revoke the old key after **Test credentials** passes.
5. Never commit keys or paste them into chat logs.
