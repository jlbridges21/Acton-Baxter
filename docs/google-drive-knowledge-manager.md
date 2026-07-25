# Google Drive Knowledge Manager

Baxter does **not** ingest every Drive file the connected account can see. Administrators browse Drive, select files, and click **Add to Baxter**. Sync and Knowledge Base creation happen in that one action.

## Authentication (Prompt 2)

**Preferred:** Google Workspace OAuth (`GOOGLE_AUTH_MODE=workspace_oauth`) as `baxter@actonadu.com`.

The Cloud service account is often **external** to Acton ADU and cannot join internal Shared Drives. Full setup: `docs/google-workspace-oauth-setup.md`.

| Variable                | Role                                                 |
| ----------------------- | ---------------------------------------------------- |
| Connected OAuth account | API caller for browse/sync when OAuth mode is active |
| `GOOGLE_CLIENT_EMAIL`   | Optional service-account fallback                    |

---

## Daily workflow (simplified)

1. Open **Connectors → Google Workspace** (`/admin/connectors/google`).
2. If already connected with Acton ADU as the active Drive, the file browser loads immediately — no Browse / Connect root / Open browser steps.
3. Navigate folders, select supported files (Docs, Sheets, Markdown, Text, PDF, DOCX, CSV, **XLSX**).
4. Click **Add selected to Baxter** — selections save, sync runs, Knowledge entries appear.
5. Remove anytime with **Remove selected from Baxter**, or from Knowledge Center with **Remove from Baxter**.

**Sync changes** updates already-added files. Technical tests, cron notes, and dry-runs live under **Connection settings → Advanced diagnostics**.

## Sharing model

1. Connect Google Workspace in Baxter (once).
2. Ensure `baxter@actonadu.com` can open the Acton Shared Drive in drive.google.com.
3. Choose **Acton ADU** (or another Shared Drive) once — it persists as the active root.
4. Add files with **Add to Baxter**.

## Shared Drive

1. Prefer OAuth (not SA membership).
2. On first visit after connect, pick the Shared Drive card (**Use this Drive**).
3. Returning visits open that Drive’s browser automatically.

Google Drive remains **read-only**. Baxter never creates, edits, deletes, or changes sharing on Google files.

## Remove from Baxter

- From the Drive browser or Knowledge Center / entry detail.
- Disables the Google source selection, archives the active Knowledge entry, leaves the Google file untouched.
- Past Baxter answers keep frozen citation snapshots (migration `015`).

## Consistency repair

**Advanced diagnostics → Repair Google knowledge** runs `reconcileGoogleKnowledgeState()` to fix selected-without-entry and related drift.

## Cron

Browsers do not send the Bearer cron secret. Use **Sync changes** from the admin UI for manual sync. Cron remains for background refresh when configured.

## Supported file types

- Google Docs / Sheets (full text)
- Markdown / plain text / CSV
- PDF / DOCX / **XLSX** (downloaded and parsed via Knowledge Import parsers)
