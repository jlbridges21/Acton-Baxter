# Knowledge Center

The Knowledge Center is the admin home for everything Baxter learns from.

URL: `/admin/knowledge`

## Layout

- **Top:** Search + New Entry / Upload Files / Google Workspace
- **Left:** Knowledge, Recent, Google Workspace, Uploads, Drafts, Approved, Archived, Failed Imports, Connector Health, Settings
- **Main:** Modern knowledge table
- **Right:** Statistics, connector health, recent imports, citation insights

## Entry pages

Notion-style entry view with tabs:

- Content
- History
- Sources
- Baxter Usage

## Uploads

`/admin/knowledge/upload` — drag/drop, preview, warnings, duplicate detection, import progress.

## Google Workspace

`/admin/connectors/google` — Drive browser first. Add/remove files from Baxter in one click. Connection settings and advanced diagnostics are secondary.

Google-managed Knowledge entries can be removed directly from the Knowledge Center (**Remove from Baxter**). Historical Baxter citations keep frozen titles/URLs after removal (migration `015`).

Supported Google imports include Docs, Sheets, Markdown, Text, PDF, DOCX, CSV, and **XLSX**.

## Settings

`/admin/knowledge/settings` — upload limits, model, Google connection, Slack note, knowledge totals.

## Employees

Employees never see Knowledge Center, uploads, or Google auth. They only see Baxter answers and approved citation links.
