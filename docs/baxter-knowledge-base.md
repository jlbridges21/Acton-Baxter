# Baxter Knowledge Base

## Purpose

The Knowledge Base stores Acton ADU institutional knowledge (procedures, policies, RACI notes, and related process docs) so Baxter can later answer employees from **approved** sources only.

## Roles

| Role                   | Access                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| salesperson / employee | Cannot manage Knowledge Base. Future retrieval returns only **approved + internal** entries. |
| admin                  | Full CRUD, approve, archive, restore, delete, revision history, sources                      |

Authorization is enforced in API routes (`requireAdmin`) and mutation helpers. Database RLS also restricts access.

## Statuses

- **draft** — editable working copy; never used for employee answers
- **approved** — eligible for Baxter retrieval (if visibility is `internal`)
- **archived** — retained for history; never used for answers

## Approval workflow

1. Admin creates or edits an entry (usually as draft).
2. Admin approves the entry (`approved_by` / `approved_at` recorded).
3. Meaningful content edits to an approved entry:
   - save prior version to `knowledge_entry_revisions`
   - increment `version`
   - return status to **draft**
   - clear approval until re-approved
4. Archive removes the entry from retrieval; restore returns it to draft.

Deleting an entry permanently removes it and cascades revisions. Confirmation is required in the UI.

## Admin usage

1. Open Baxter Dashboard → **Manage Knowledge** (admins only), or go to `/admin/knowledge`.
2. Create an entry with title, content, category, tags, and source fields.
3. Approve when ready for Baxter.
4. Use **Knowledge Sources** (`/admin/knowledge/sources`) for manual source registry only.

## Future Slack retrieval

`searchApprovedKnowledge()` returns ranked approved internal results with:

- title, summary, excerpt
- category, tags
- source name/URL
- citation label (e.g. `Sales Process — PEM Preparation Checklist`)
- relevance score

Draft, archived, and admin_only entries are excluded.

## Security notes

- No API keys or secrets in `knowledge_sources`
- Future Google Drive / GHL / Buildertrend / Domo are shown as **Not connected** only
- OpenAI and Slack AI conversations are **not** implemented in this prompt

## Migration

Run in Supabase SQL Editor (or CLI) after prior migrations:

`supabase/migrations/006_knowledge_base.sql`
