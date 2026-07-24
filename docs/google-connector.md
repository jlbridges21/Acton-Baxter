# Google Workspace connector

## Purpose

Google Docs and Sheets are the **source of truth**. Baxter syncs their text into the Knowledge Base so answers are fast and always cite the original Google URL.

Admin UI: **`/admin/connectors/google`**

---

## Service account vs `baxter@actonadu.com`

| Identity                  | Role                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **`GOOGLE_CLIENT_EMAIL`** | Service account principal that calls Google APIs (e.g. `baxter-sync@project.iam.gserviceaccount.com`)      |
| **`baxter@actonadu.com`** | Google Workspace **user** identity — useful as an admin contact, **not** automatically the service account |

**Sharing folders only with `baxter@actonadu.com` is not enough** unless that address is also the service account email or domain-wide delegation is configured for the SA.

Baxter never stores Google OAuth user tokens in the database.

---

## Setup

1. In Google Cloud, create or use an Acton project.
2. Enable **Google Drive API**, **Google Docs API**, and **Google Sheets API**.
3. Create a **service account** and JSON key.
4. Copy to Vercel:
   - `client_email` → `GOOGLE_CLIENT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
   - project id → `GOOGLE_PROJECT_ID`
5. Share Drive folders with **`GOOGLE_CLIENT_EMAIL`** (Viewer is enough).

---

## Private key normalization

Keys pasted into Vercel often break on newlines. Baxter normalizes `GOOGLE_PRIVATE_KEY` automatically:

- Strips surrounding `"` or `'`
- Converts literal `\n` to real newlines
- Normalizes `\r\n` to `\n`
- Validates `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` markers

If authentication fails with `BAXTER_GOOGLE_PRIVATE_KEY_INVALID`, re-paste the key from the JSON file (full PEM block) or use escaped `\n` on one line.

Redeploy after changing the key.

---

## Shared Drive vs My Drive

| Location                     | Access requirement                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **My Drive / shared folder** | Share folder with `GOOGLE_CLIENT_EMAIL` (Viewer+)                                                             |
| **Shared Drive**             | Add the service account as a **Shared Drive member**, or share the specific folder with `GOOGLE_CLIENT_EMAIL` |

The admin **Test root folder** diagnostic reports whether a Shared Drive was detected and shows guidance.

Common errors:

| Code                                       | Meaning                      |
| ------------------------------------------ | ---------------------------- |
| `BAXTER_GOOGLE_SHARED_DRIVE_ACCESS_DENIED` | SA not a Shared Drive member |
| `BAXTER_GOOGLE_FOLDER_ACCESS_DENIED`       | Folder not shared with SA    |
| `BAXTER_GOOGLE_FOLDER_NOT_FOUND`           | Wrong folder ID              |

---

## Folder configuration

1. In Google Drive, open the folder with Acton SOPs / policies.
2. Share with **`GOOGLE_CLIENT_EMAIL`**.
3. Copy folder ID from URL (`/folders/FOLDER_ID`) or paste full Drive URL.
4. In Baxter → **Connectors → Google Workspace**, add the folder.
5. Run **Dry-run sync**, then **Run real sync**.

`GOOGLE_DRIVE_ROOT_FOLDER` can seed a default root; admin-added folders are stored in the database.

---

## Sync behavior

- Docs → exported as plain text
- Sheets → exported as CSV text
- Plain text / markdown → downloaded
- PDF / Word → metadata stub only (no OCR)
- Unchanged content hashes are skipped
- Changed files update Knowledge Base entries and keep them **approved**
- Answers cite the Google `webViewLink`, never model-invented URLs

---

## Dry-run sync

**Dry-run sync** lists what would be indexed **without** writing to the Knowledge Base. Use it after credential or folder changes.

Admin action at `/admin/connectors/google` → **Dry-run sync**.

---

## Scheduled sync

When enabled, Baxter enqueues `google_knowledge_sync` jobs on a schedule:

| Variable                       | Default | Notes                                    |
| ------------------------------ | ------- | ---------------------------------------- |
| `GOOGLE_SYNC_ENABLED`          | `true`  | Set `false` to disable scheduled enqueue |
| `GOOGLE_SYNC_INTERVAL_MINUTES` | `180`   | Min 15, max 1440                         |

Scheduling runs inside **`/api/internal/process-jobs`** (Vercel Cron — see `vercel.json`; Hobby-safe default is daily at 12:00 UTC). The scheduler:

- Skips if interval has not elapsed since last folder sync (`GOOGLE_SYNC_INTERVAL_MINUTES`)
- Avoids overlapping queued/running sync jobs
- Requires active sync folders or `GOOGLE_DRIVE_ROOT_FOLDER`
- Does nothing for Google when `GOOGLE_SYNC_ENABLED=false` (manual sync still works)

Admins should use **Run sync now** (admin-authenticated; no cron secret). Opening `/api/internal/process-jobs` in a browser returns 401 — that is expected.

Full Knowledge Manager guide: [`docs/google-drive-knowledge-manager.md`](./google-drive-knowledge-manager.md).

---

## Admin diagnostics actions

At **`/admin/connectors/google`**:

| Action                      | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| **Test credentials**        | Mint access token; checks key format             |
| **Test root folder**        | Folder metadata + Shared Drive detection         |
| **Browse files**            | Drive browser from connected root                |
| **Preview selected**        | Bounded text preview (no KB write)               |
| **Add to Baxter**           | Explicit file/folder selection                   |
| **List sample files**       | Sample supported files in root/folders           |
| **Dry-run sync**            | Preview sync without KB writes                   |
| **Run sync now**            | Enqueue/process sync without cron secret         |
| **Process pending job now** | Claim one google sync job                        |
| **Test through Baxter**     | Retrieval + citation in `answerBaxterQuestion()` |

Configuration panel shows: project ID present, client email, private key valid format, root folder configured, sync enabled, interval minutes. Secrets are never displayed.

---

## `BAXTER_GOOGLE_*` error codes

| Code                                       | Meaning                                               | Typical fix                                      |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| `BAXTER_GOOGLE_NOT_CONFIGURED`             | Missing `GOOGLE_CLIENT_EMAIL` or `GOOGLE_PRIVATE_KEY` | Set env vars; redeploy                           |
| `BAXTER_GOOGLE_PRIVATE_KEY_INVALID`        | Malformed PEM after normalization                     | Re-paste key from JSON                           |
| `BAXTER_GOOGLE_AUTH_FAILED`                | Token exchange failed                                 | Verify SA key not revoked; APIs enabled          |
| `BAXTER_GOOGLE_API_DISABLED`               | Drive/Docs/Sheets API disabled                        | Enable APIs in Cloud Console                     |
| `BAXTER_GOOGLE_FOLDER_NOT_FOUND`           | Bad folder ID                                         | Fix folder ID / URL                              |
| `BAXTER_GOOGLE_FOLDER_ACCESS_DENIED`       | Folder not shared with SA                             | Share with `GOOGLE_CLIENT_EMAIL`                 |
| `BAXTER_GOOGLE_SHARED_DRIVE_ACCESS_DENIED` | SA not on Shared Drive                                | Add SA as Shared Drive member                    |
| `BAXTER_GOOGLE_EXPORT_FAILED`              | Export/download failed                                | Check file type / permissions                    |
| `BAXTER_GOOGLE_SYNC_FAILED`                | General sync failure                                  | Check Vercel logs + last error on connector page |

---

## Environment

```bash
GOOGLE_PROJECT_ID=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_ROOT_FOLDER=
GOOGLE_SYNC_ENABLED=true
GOOGLE_SYNC_INTERVAL_MINUTES=180
```

---

## Related routes

- `/admin/connectors` — all connectors overview
- `/admin/connectors/google` — folders, sync, diagnostics
- `/admin/baxter/diagnostics` — Baxter AI health
- `/admin/baxter/launch-readiness` — launch checklist snapshot
- `docs/baxter-troubleshooting.md` — Google + OpenAI troubleshooting
