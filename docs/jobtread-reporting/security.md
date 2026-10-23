# 11. Report security model

**Principle:** a report is a definition. Data is computed per viewer, per request, on the
server, from that viewer's access. Sharing a report never shares data the recipient can't see.

## Who can use Reports

Access comes from the AI Workforce permission model on the **Dexter** agent
(`src/lib/reports/access.ts`):

| Data category                   | Who sees it                                                   | Examples                                   |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Project information (`general`) | Anyone with Ask through Baxter or Chat directly on Dexter     | Phase, PM, model, sq ft, site & utilities  |
| Customer details (`customer`)   | "Customer details (Reports)" on Dexter, or admins             | Customer contact-type fields               |
| Financial figures (`financial`) | "Financial figures (Reports)" on Dexter, or admins            | Projected price/cost/margin, model budgets |
| Internal notes (`internal`)     | "Manage agent" on Dexter, or admins                           | Sales strategy notes                       |
| Edit business rules             | "Edit business rules (Reports)" + financial access, or admins | Commission rates, project assignments      |
| Excluded                        | Nobody                                                        | Vendor fields, fields an admin excludes    |

Admins set each field's category in **Reports → Data settings**.

## What happens with restricted data

- KPIs and charts that measure or group by a restricted field show "Requires … access" with
  no value — not a zero.
- Tables drop restricted columns and say how many were hidden; drilldowns and CSV exports
  include only authorized columns; filters on restricted fields are disabled.
- The field picker, Dexter's field list, and the widget builder never list restricted fields.

## Report permissions (`src/lib/reports/repo.ts`)

| Action                  | Allowed for                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| View                    | Owner, admins, everyone (when "Everyone with Reports access"), explicit shares (user, department, role) |
| Edit / Dexter edits     | Owner, admins, "can edit" shares. Templates: admins and Dexter managers                                 |
| Share, transfer, delete | Owner or admin (templates can be archived, not deleted)                                                 |
| Pin                     | Anyone who can view (pins are personal)                                                                 |

Missing and forbidden reports return the same "Report not found".

## Attachments & business rules

- Attachments are private to the uploader (storage + API); validated by extension, size, and
  magic bytes; extracted content is labeled user-supplied and passed to Dexter as data.
- Commission data needs financial access to view; changes need "Edit business rules" and are
  recorded in `bi_rule_changes` (who, when, before/after). Nothing is paid, submitted, or written
  to JobTread.

## Platform safeguards

- JobTread is **read-only** (code guard on every query) and the grant key never leaves the
  server (see [setup](setup-and-deployment.md#3-authentication-and-credential-management)).
- All tables have RLS on with no browser policies; route handlers authorize every request.
- The AI cannot emit executable content: specs are validated JSON rendered by trusted
  components; React escapes all text.
- Report content and tool results reach Dexter as **data blocks**, not instructions (prompt
  injection test in `tests/unit/reports-dexter.test.ts`).
- CSV export prefixes formula-like cells (`=`, `+`, `-`, `@`) to prevent spreadsheet injection.
- Sharing, field-category, mapping, connection, and sync changes are written to the AI audit
  log.
