# Google Workspace connector

## Purpose

Google Docs and Sheets are the **source of truth**. Baxter syncs their text into the Knowledge Base so answers are fast and always cite the original Google URL.

Admin UI: **`/admin/connectors/google`** (labeled **Google Workspace**)

**Primary production auth:** Google Workspace OAuth as `baxter@actonadu.com`  
See **`docs/google-workspace-oauth-setup.md`**.

---

## Why service accounts often fail on Acton Shared Drives

`baxter@baxter-503419.iam.gserviceaccount.com` is **external** to Acton ADU Workspace. Google blocks adding it to internal-only Shared Drives. SA token mint can succeed while Shared Drive listing still fails — use Workspace OAuth instead.

---

## Auth modes (`GOOGLE_AUTH_MODE`)

| Mode                        | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `workspace_oauth` (default) | Admin connects an Acton Workspace user; refresh token encrypted at rest      |
| `service_account`           | JWT with `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`                        |
| `domain_wide_delegation`    | Only when SA + `GOOGLE_IMPERSONATED_USER` + Workspace DWD are fully verified |

---

## Service account vs `baxter@actonadu.com`

| Identity                  | Role                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| **Connected OAuth user**  | Preferred API caller for Shared Drives (e.g. `baxter@actonadu.com`)    |
| **`GOOGLE_CLIENT_EMAIL`** | Optional SA principal for My Drive shares / orgs that allow SA members |

Refresh tokens are stored **encrypted** in `google_connections` (migration `013`). They are never returned to the browser.

---

## Setup (OAuth — recommended)

Follow `docs/google-workspace-oauth-setup.md`, then:

1. Apply `supabase/migrations/013_google_workspace_oauth.sql`
2. Set Vercel OAuth + `GOOGLE_TOKEN_ENCRYPTION_KEY` vars
3. Redeploy → **Connect Google Workspace**

## Setup (service account — fallback)

1. Enable Drive, Docs, Sheets APIs.
2. Create a service account JSON key.
3. Set `GOOGLE_AUTH_MODE=service_account` plus `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`.
4. Share **My Drive** folders with the SA (Shared Drives may still reject external SAs).

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

| Location                          | Recommended approach                                        |
| --------------------------------- | ----------------------------------------------------------- |
| **Shared Drive (Acton internal)** | Workspace OAuth as `baxter@actonadu.com` → Connect as root  |
| **My Drive / shared folder**      | OAuth user access, or share with SA in service-account mode |

Do **not** assume the Cloud service account can join an Acton Shared Drive.

Common errors:

| Code                                     | Meaning                                 |
| ---------------------------------------- | --------------------------------------- |
| `BAXTER_GOOGLE_DRIVE_API_DISABLED`       | Enable Drive API via Library search     |
| `BAXTER_GOOGLE_PERMISSION_DENIED`        | Connected account lacks access          |
| `BAXTER_GOOGLE_SHARED_DRIVE_NOT_VISIBLE` | Drive not visible / external SA blocked |
| `BAXTER_GOOGLE_REAUTHORIZATION_REQUIRED` | Reconnect Google Workspace              |
| `BAXTER_GOOGLE_FOLDER_NOT_FOUND`         | Wrong folder ID                         |

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
