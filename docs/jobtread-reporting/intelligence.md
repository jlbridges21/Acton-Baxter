# Dexter intelligence: data catalog, feasibility, planning, attachments, business rules

This release turns Dexter from "build a dashboard from a prompt" into an analyst workflow:
**understand → investigate → clarify → plan → build → validate → refine**. Each step is backed
by real tools and stored state, not prompt text.

## Verified Data Catalog

`src/lib/jobtread/catalog.ts` probes every reporting-relevant JobTread entity with the live
grant and stores **metadata and counts only** in `jt_entity_catalog`:

| Level          | Meaning                                                | How it's established                                  |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Documented     | Listed in `ENTITY_DEFS` from the JobTread docs         | Code                                                  |
| Accessible     | The field resolves in a real query with this grant     | Live query; unknown fields are dropped and retried    |
| Populated      | Records with a value                                   | `where [[field], "!=", null]` counts — no values read |
| Reportable     | Synced into Baxter's cache and usable in reports today | Code                                                  |
| Visible to you | Allowed by the viewer's Reports access                 | `src/lib/reports/access.ts`                           |

The catalog re-verifies during a sync when it's over a day old, and admins can re-verify on
demand. **UI:** `/reports/catalog` (all Reports users; field lists honor access, and restricted
categories show only counts) with Overview, Fields (search + fill rates), What's possible
(capability matrix), Business names, and Suggested reports.

### Verified on 2026-10-22 (live, read-only)

| Entity                          |         Records | Notes                                                                                   |
| ------------------------------- | --------------: | --------------------------------------------------------------------------------------- |
| Jobs                            |             447 | `projectedPrice/Cost` set on **1** job; `actualCost` > 0 on **0**; `closedOn` on 0      |
| Documents                       |             383 | 372 draft + 1 approved customer orders (43 jobs), 10 draft invoices; **$0 paid on all** |
| Payments                        |           **0** | No payment records → no payment dates in JobTread                                       |
| Time entries                    |           **0** | No design hours                                                                         |
| Custom fields                   |             121 | Includes job option **Sales Rep** (Kevin, Stan, Jesse, Connor)                          |
| Cost groups                     |             887 | 79 top-level (catalog); 77 Product Library models                                       |
| Cost items                      |           5,175 | Verified, not synced                                                                    |
| Tasks                           |           4,343 | Live per project                                                                        |
| Accounts / contacts / locations | 745 / 479 / 493 | 289 vendor accounts                                                                     |
| Files / daily logs              |       276 / 757 | Files live per project                                                                  |
| Memberships                     |               2 | JobTread logins                                                                         |

Sales Rep is filled on 33 of 447 jobs (Kevin 17, Jesse 8, Stan 8, **Connor 0**).

## Capability matrix & feasibility

`src/lib/reports/capabilities.ts` maps business needs to live status:
`ready · partial · needs_mapping · needs_business_rules · restricted · unavailable · not_connected`.
Each entry says what exists (with counts), what's missing and why it matters, and an alternative.
`assessFeasibility()` turns a list of requirements (capability keys and/or field refs) into a
verdict: `ready | ready_with_gaps | needs_mapping | needs_business_rules | blocked_permission |
needs_external_data | not_connected`. Dexter calls it through `reports_capabilities`; the hub's
**Suggested reports** and the catalog use the same engine, so a report is only called buildable
when its requirements are.

## Planning memory (clarification)

`bi_report_sessions` holds one structured requirements object per conversation thread: goal,
audience, data sources, metrics, calculations, filters, visualizations, business rules, attachment
references, assumptions (confirmed or not), **questions** (id, why, options, status, answer), a
widget plan with statuses (ready / building / awaiting clarification / unavailable / done), and a
feasibility note. Dexter reads it every turn and updates it with `reports_plan`; questions merge by
id so answers are never lost or asked twice. The chat's **Plan** panel shows it and lets people
answer questions with one click; answers are saved and sent to Dexter. When a draft conversation
creates a report, the plan and attachments move onto that report.

## Attachments (images, PDFs, spreadsheets)

- Chat: attach button, drag-and-drop, paste; up to 6 files per message; upload progress,
  thumbnails, remove, and clear errors. Types: PNG/JPG/WebP (5 MB), PDF (20 MB), CSV/XLSX/DOCX
  (10 MB), TXT (2 MB). The server re-validates extension, size, and **magic bytes**.
- Storage: private `report-attachments` bucket; the file route serves bytes only to the uploader.
- Images are analyzed once by a vision model into structured JSON (purpose, sections, KPIs with
  the value _shown_, charts, tables/columns, filters, visible formulas, status colors,
  interactions, implied fields, dates, transcribed text). Dexter's Claude model is used when an
  Anthropic key is configured, otherwise Baxter's vision provider (`BAXTER_VISION_PROVIDER`,
  OpenAI). `analyzed_by` records which model read it. If analysis fails the attachment is marked
  **failed**, and Dexter is told it couldn't be read.
- PDF/DOCX/XLSX/CSV/TXT text is extracted with the existing knowledge parsers.
- Everything extracted is labeled **user-supplied reference material** — never JobTread data — and
  passed to Dexter as data; instructions inside files are ignored. `reports_attachment` lets
  Dexter re-read a file or ask a follow-up question about an image ("the second screenshot").

## Business rules & commissions

Values that don't exist in JobTread live in Baxter (never written back):

- `bi_rule_sets` (calculation config), `bi_commission_rates` (effective-dated; a new rate closes
  the previous one the day before, so history is reproducible), `bi_project_assignments`
  (salesperson, split %, payment date), `bi_rule_changes` (who, when, before/after, note).
- Engine (`src/lib/reports/commissions.ts`, pure): **commission = eligible gross profit × rate % ×
  split %**, rounded to cents once. Project overrides beat salesperson rates; the rate in effect on
  the commission date applies; losses are zeroed or included by policy; missing gross profit,
  rate, or date produce a **status**, never a number.
- Gross-profit basis: `order_gross_profit` (approved customer order, else latest draft — the only
  workable basis today) or `job_projected_gross_profit`. Date source: Baxter-entered payment date
  (default — JobTread has none), customer order date, or latest invoice date.
- Salespeople: Baxter assignments, else JobTread's **Sales Rep** field. Names are data — nothing is
  hardcoded.
- Report integration: dataset `{ "source": "commissions", "ruleSet": key }` with `com.*` fields;
  widgets `rate_editor` and `assignment_editor` render trusted editors inside the report.
- Permissions: viewing needs **Financial figures (Reports)**; changing needs **Edit business rules
  (Reports)** + financial access (admins have both). Dexter can only enter values the user stated,
  and only for people with that access. Decision support only — nothing is paid or submitted.

### The commission request, end to end

"Create a sales commissions report… Kevin, Connor, and Jesse… set rates, select the salesperson,
assign projects… payment date and Gross Profit from JobTread."

1. Dexter reads the attached screenshot's analysis and checks `reports_capabilities`:
   gross profit → _partial_ (projected, from customer orders on 43 jobs, 1 approved);
   payment dates → _not in JobTread_ (0 payments) with the alternative "enter payment dates in
   Baxter"; salesperson → _partial_ (Sales Rep on 33 jobs; Connor on none).
2. He records the plan and asks only what matters (e.g. approved-only vs. latest-draft gross
   profit; the rates), then stops.
3. After the answers, he creates a rule set, configures and confirms it, enters the stated rates,
   assigns projects, and builds the dashboard (KPIs, salesperson selector, table, charts, rate and
   assignment editors).
4. Authorized people adjust rates and assignments in the report; totals recalculate.

The **Sales Commissions** template ships with an empty default rule set (no rates) for the same
dashboard without Dexter.

## New Dexter tools

`reports_data_catalog`, `reports_capabilities`, `reports_suggest`, `reports_plan`,
`reports_attachment`, `reports_rules` (plus the existing report tools). Limits rose to 14 steps /
24 tool calls / 260 s / 600k tokens / $4 per request; up to 5 tool calls per reply, and calls past
the cap are reported back instead of silently dropped. On first load after deploy, a one-time
system version adds the new tools to Dexter's published config and replaces instructions and
limits **only if they still equal the shipped defaults** — AI Studio customizations are kept.
