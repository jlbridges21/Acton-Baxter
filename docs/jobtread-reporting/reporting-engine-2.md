# Reporting engine 2.0 — calculated fields, grouping, viewer controls, relationships

Reports are configuration, never code. Dexter and the report editor write a validated
report spec; the server computes every number; trusted components render it. This upgrade
adds four capabilities to that spec without changing how existing reports are stored.

## For employees

**Calculated fields (Metric Library — Reports → Metric Library, `/reports/metrics`)**

- A calculated field is referenced as `calc:<key>` and can be used as a KPI value, chart
  metric, table column, filter, or sort — wherever a normal field goes.
- Three kinds:
  - **Per record** (row formula): `job.projectedPrice - job.projectedCost`. One value per
    record; can be filtered, grouped, summed, or averaged.
  - **Per group** (aggregate formula): `(SUM(job.orderPrice) - SUM(job.orderCost)) /
SUM(job.orderPrice) * 100`. Computed from each group's totals — a _weighted_ margin. In
    tables, every subtotal and the grand total recompute it from that group's records.
  - **From related records** (rollup): e.g. a job's total budget cost from its cost items.
- Blank is never treated as zero. Use `COALESCE(x, 0)` to count blanks as zero explicitly.
  Dividing by zero gives a blank, never a wrong number.
- "Preview on real data" shows how many records got a value, how many were blank and why,
  and sample values, before you save.
- **Private** metrics are yours to edit (anyone can use them in a report you share; viewers
  still need access to every field the formula reads). **Company** metrics are shared
  definitions only Reports managers can change. Every save is a new version; archiving keeps
  history and shows which reports use the metric.

**Formula reference**

|                                      |                                                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operators                            | `+ - * / %`, `( )`, `= != < <= > >=`, `AND OR NOT`, `&` joins text                                                                                                                                                                |
| Functions                            | `IF(cond, a, b)`, `COALESCE(a, b, …)`, `ABS`, `ROUND(x, d)`, `MIN(a, b)`, `MAX(a, b)`, `DIVIDE(a, b)`, `PERCENT(part, whole)`, `DAYS_BETWEEN(start, end)`, `NUMBER`, `TEXT`, `ISBLANK`, `CONTAINS(text, "part")`, `YEAR`, `MONTH` |
| Aggregates (per-group formulas only) | `SUM`, `AVG`, `MEDIAN`, `COUNT()`, `COUNT(x)`, `COUNT_DISTINCT`, `MIN(x)`, `MAX(x)`                                                                                                                                               |

**Grouped tables.** Tables can nest up to four levels (e.g. Phase → Project Manager → Job)
with record counts, subtotals, and a grand total. Use Expand all / Collapse all / Expand to
level. Your expanded groups and hidden columns are remembered in your browser only.

**Viewer controls.** Reports can offer _Group by_ (pick and reorder levels), _Sort_ (field and
direction), and _Show_ (metric) controls. Changing them only changes your view.
_My views_ saves your current grouping, sorting, and filters under a name; star one to make it
your default for that report. _Reset to the report's default_ returns to the published view.
Only editors change the published defaults (by saving a new report version).

## For administrators

- **Relationships** (Reports → Data settings → Relationships) lists how sources connect, always
  by stable JobTread ids:
  - _Lookups_ (many-to-one): approved fields of the related record are readable on the source's
    rows — e.g. a cost item's job Phase (`sem:phase`), or a commission row's job fields. Approve
    or remove fields here; only fields that already exist on the related source qualify, and
    each keeps its own access category.
  - _Rollups_ (one-to-many): `jobs.cost_items`, `jobs.commissions`, `catalog_models.cost_items`.
    Child records are aggregated onto the parent by id, so parent rows are never multiplied and
    totals never double count.
- **Report-specific relationships.** A report can define its own joins in its spec
  (`relationships`): a _lookup_ brings fields of a related record onto each row (key = a field
  holding that record's JobTread id), a _rollup_ lets a calculation total related records per
  parent. Dexter finds them with `reports_relationship_discover`, which checks real values: a
  key must match the other source's ids (≥95% for "verified"). Name matches are reported but
  never used. Dexter saves verified relationships to the report without asking (it's
  reversible, and viewers still need access to every related field). On save, a key that
  isn't a declared id field must have at least 90% of its values matching real ids, or the
  save is refused with the reason.
- **Company relationships.** Administrators can promote a report's relationship so every report
  can use it (Dexter: `reports_relationship_promote`, preview → confirm; listed and archived
  under Data settings → Relationships). A new data source registers its built-in id links in
  `src/lib/reports/relationships.ts` (plus `ID_FIELDS` in `report-relationships.ts`).
- **Safety rules applied by the engine:** joins only on stable ids, lookups never add or drop
  rows, rollups are pre-aggregated per parent, a field reachable through two different joins
  is rejected as ambiguous, and at run time a report shows a warning when fewer than 90% of
  keyed records find their related record.
- Migrations: `078_related_report_fields.sql` (related-field approvals) and
  `079_reporting_engine_2.sql` (Metric Library, metric versions, company relationships, saved
  personal views). Both
  are additive. Without them the defaults still work; the Metric Library and saved views stay
  empty until 079 is applied.

## For Dexter

Dexter's tools (enabled on its published config by the "System: Dexter reporting engine 2.0"
seed step): `reports_calculation_check`, `reports_metrics`, `reports_metric_save`,
`reports_metric_archive`, `reports_relationships`, `reports_relationship_check`,
`reports_relationship_discover`, `reports_relationship_promote`,
`reports_relationship_approve_field`, plus `reports_update` operations `set_calculation`,
`remove_calculation`, `set_relationship`, and `remove_relationship`. The spec guide in `reports_create` / `reports_update` documents
calculations, `groupLevels`, and the `group_by` / `sort` / `metric_picker` controls, so new
capabilities are discoverable without changing Dexter's instructions.

Approval policy: ordinary reversible report edits (widgets, layout, report-specific
calculations and relationships, viewer controls) save directly as new report versions. Company metrics require
Reports manager access. Approving related fields requires an administrator and a preview →
confirm step, and is audited.

## Correctness and limits

- Formulas are parsed into a tree and evaluated by the engine — never `eval`, SQL, or JS.
  Limits: 1,000 characters, 300 nodes, depth 40. Circular references, unknown fields, wrong
  types, and fields from other sources are rejected with a specific message.
- A calculation's access requirement is the union of the fields it reads (directly or through
  other calculations).
- Aggregate calculations can't be filters, groupings, or chart axes (they have one value per
  group). Records with several values in a grouping field appear under each value; the grand
  total counts them once.
- Grouped tables send up to 5,000 records with the groups (up to 1,500 group nodes) and show 50
  records per group at a time; ungrouped tables keep their 1,000-row cap.
