# Authorization

## Principles

- **Server first.** Every route runs `requireActiveUser` (or `requireAdmin`) before any
  provider. The browser only renders what the server returned.
- **Existing rules, not new ones.** Each provider calls the permission functions its domain
  already uses (see the table below).
- **Filter at retrieval.** Index queries pass the viewer's role, user id, and capability tags
  into SQL (`global_search_query`), so rows the viewer can't see are never read into the app.
  Then the provider's `lookup` re-reads the source of truth and re-checks permission (defense
  in depth).
- **Nothing hidden is counted.** Section counts are computed from results the viewer may see.
  Categories the viewer isn't permitted to use are absent: no pill, no section, no count.
- **Safe output.** Titles, subtitles, descriptions, and previews pass through `safeText`
  (no markup, capped length). URLs must be same-origin paths or https on an allow-listed host
  (`app.jobtread.com`, the floor plan library). Anything else is dropped.
- **Ids are validated** (`safeId`) before being used in a link.
- **Audit.** BambooHR searches, opening a customer or employee result, and every admin
  action (reindex, enable/disable, field changes, synonyms) are written to `ai_audit_log`.
  Audit rows never contain record contents.

## Per-provider rules

| Provider                | Rule (server-side)                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools / Settings        | `audience: "admin"` entries only for admins; `requires` checks: `reports` (Reports access), `reports_admin`, `ops_full` (CEO, COO, HR admin, or app admin configuring Sam), `ops_view_all` (CEO, COO, HR admin) |
| AI agents               | `canViewWorkspace`; employees see active published agents; admins also see drafts and paused agents; chat action only with `direct_chat`                                                                        |
| Reports                 | `getReportsAccess().canUse`; each report via `permissionFor` (owner, admin, company visibility, share); groups via `listGroupsFor` (personal groups only to their owner)                                        |
| GoHighLevel             | Connector policy mapping: admin → admin, user → salesperson (read), anything else → none                                                                                                                        |
| JobTread jobs           | Reports `general` category; customer-category fields need `customer`; financial and internal fields never                                                                                                       |
| BambooHR                | `BambooAccess.canViewAll` (CEO, COO, HR admins); audited                                                                                                                                                        |
| Knowledge               | `canUserReadKnowledgeEntry` (approved+internal for all; drafts for the author; admins all)                                                                                                                      |
| Inventory / Inspections | Approved employees, as on their pages; costs never searchable; notes searchable (visible on those pages)                                                                                                        |
| AI tasks                | `listVisibleTasks` / `canViewTask`; confidential tasks only for the person who started them                                                                                                                     |

## Permission changes

The index never stores per-user grants. ACL columns hold roles, specific user ids (knowledge
drafts), or capability tags (`reports:general`). The viewer's current access is evaluated on
every query. When access is removed (a share revoked, a role changed, a draft archived, an HR
admin removed), the next search reflects it immediately, before any reindex.

## Recents

Recents store `(user, provider, record id, count)` and no titles. A record is stored only if
the provider's `lookup` confirms the viewer can see it, and every recent is re-authorized
through `lookup` when the empty view loads. Items the viewer has lost access to, or that were
deleted, disappear silently. Recents are per user and are never shown to anyone else.

## Admin restrictions

Admins can enable, disable, and re-field providers, but only from each provider's
`standard` fields. `validateFieldSelection` rejects restricted keys with an error; they are
never silently dropped. Core providers (tools, settings, agents, reports) can't be disabled.
