# Baxter Knowledge Base

## Purpose

The Knowledge Base stores Acton ADU institutional knowledge so Baxter can answer employees from **approved + internal** sources only.

## Admin home

**`/admin/knowledge`** is the **Knowledge Center** — see `docs/knowledge-center.md`.

Primary actions:

- **New Entry** → `/admin/knowledge/new` (title + content only)
- **Upload Files** → `/admin/knowledge/upload`
- **Google Workspace** → `/admin/connectors/google` (Drive browser → **Add to Baxter**)
- **Settings** → `/admin/knowledge/settings`

## Roles

| Role                   | Access                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| salesperson / employee | No admin Knowledge navigation. Retrieval uses approved + internal only. |
| admin                  | Full manage, upload, approve, archive, restore, safe delete             |

## Simple manual entry

Required:

- Title
- Content

Defaults:

- `source_type = manual`
- `source_name = Manual entry`
- `visibility = internal` (All Acton employees)
- `category = General`
- `tags = []`
- status = draft unless **Approve and publish**

Advanced options (optional): summary, category, tags, source name, source URL, visibility.

## Statuses

- **draft** — not available to Baxter
- **approved** — Baxter can use it (when visibility is internal)
- **archived** — unavailable to Baxter; history preserved

### Editing approved entries

Saves a revision, increments version, returns to **draft**, and requires re-approval.

## Deletion

Hard delete works for unused manual/uploaded entries.

If Baxter has cited the entry:

> Archive it instead to preserve conversation history.

Google-managed entries cannot be hard-deleted from the Knowledge list — use **Manage Google source**.

Migration **012** sets `baxter_message_sources.knowledge_entry_id` to `ON DELETE SET NULL` and adds upload storage.

## Uploads

See **`docs/knowledge-imports.md`**.

Libraries: Mammoth (DOCX), pdf-parse (PDF text), SheetJS/`xlsx` (Excel), built-in CSV/text/Markdown parsers.

## Source badges

- Manual
- Uploaded
- Google

## Google Drive

Navigation and existing connector pages are available now. Shared Drive authentication redesign is **Prompt 2**.
