# Google Workspace connector

## Purpose

Google Docs and Sheets are the **source of truth**. Baxter syncs their text into the Knowledge Base so answers are fast and always cite the original Google URL.

## Service account

1. In Google Cloud, create a project (or use an existing Acton project).
2. Enable **Google Drive API**, **Google Docs API**, and **Google Sheets API**.
3. Create a **service account**.
4. Create a JSON key and copy:
   - `client_email` → `GOOGLE_CLIENT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (keep `\n` escaped as in the JSON, or paste with real newlines)
   - project id → `GOOGLE_PROJECT_ID`
5. Prefer using / granting access as **baxter@actonadu.com** by:
   - Sharing Drive folders with the service account email, **or**
   - Using domain-wide delegation if your Workspace admin configures it for that SA

Baxter never stores Google OAuth user tokens in the database.

## Folder sharing

1. In Google Drive, open the folder with Acton SOPs / policies.
2. Share it with the service account email (Editor or Viewer; Viewer is enough).
3. Copy the folder ID from the URL (`/folders/FOLDER_ID`).
4. In Baxter → **Connectors → Google Workspace**, paste the folder ID and click **Add folder**.
5. Click **Run sync now**.

## Sync behavior

- Docs → exported as plain text
- Sheets → exported as CSV text
- Plain text / markdown → downloaded
- PDF / Word → metadata stub only (no OCR)
- Unchanged content hashes are skipped
- Changed files update Knowledge Base entries and keep them approved
- Answers cite the Google `webViewLink`, never model-invented URLs

## Admin routes

- `/admin/connectors` — all connectors
- `/admin/connectors/google` — folders, sync, pause/resume

## Jobs

`google_knowledge_sync` can be enqueued for Vercel cron via `/api/internal/process-jobs`.
Admins can also sync immediately from the UI.

## Environment

```bash
GOOGLE_PROJECT_ID=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_ROOT_FOLDER=
```
