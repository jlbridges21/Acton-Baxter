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

`/admin/connectors/google` — connection status, browse Drive, select sources, sync with visible progress. Technical JSON is behind “View technical details”.

## Settings

`/admin/knowledge/settings` — upload limits, model, Google connection, Slack note, knowledge totals.

## Employees

Employees never see Knowledge Center, uploads, or Google auth. They only see Baxter answers and approved citation links.
