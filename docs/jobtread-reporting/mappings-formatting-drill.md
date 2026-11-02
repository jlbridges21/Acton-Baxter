# Field mapping health, column formatting, and drill-downs

Three improvements to Dexter reporting (2026-11-02). Migration `083_field_mapping_health.sql`
is additive and **not applied**; everything except the reporting switch and review resolution
works without it.

## 1. Field mappings (Reports → Data settings → Field catalog → Field mapping health)

### Audit: how fields were discovered, stored, mapped, and exposed

| Entity                         | Custom fields discovered | Values synced                                          | In reports                      |
| ------------------------------ | ------------------------ | ------------------------------------------------------ | ------------------------------- |
| Jobs                           | yes (by id)              | `jt_jobs.job_fields` (id → values)                     | yes                             |
| Locations                      | yes                      | `jt_jobs.location_fields` (via each job)               | yes                             |
| Customers                      | yes                      | `jt_jobs.customer_fields` (via each job's account)     | yes                             |
| Vendors                        | yes                      | `jt_accounts.fields` once an admin allows the field    | no (no report source)           |
| Customer / vendor contacts     | yes                      | `jt_contacts.fields` — **was broken, now fixed**       | no                              |
| Daily logs, cost items         | yes                      | no (their syncs read standard attributes only)         | no                              |
| Tasks, files, product library  | no custom fields         | standard attributes (`jt_tasks`, `jt_files`, models)   | product library only (`model.*`) |

Findings:

- Field identity was already the JobTread id (`cf:<id>`, `jt_custom_fields.id`); renames were
  recorded (080). Reports never stored names as keys.
- **Bug fixed:** the contacts sync filtered custom-field values by target `"contact"`, but
  JobTread's targets are `customerContact` / `vendorContact`, so no contact values were ever
  cached. `EXTENDED_TARGETS` now includes both, so admins can allow them under Field access.
- **Name-based mapping:** the built-in vocabulary (`sem:*`) auto-mapped by exact name and took
  the _first_ field when several shared the name. It now maps only when exactly one live field
  matches. Aliases that were auto-mapped earlier and whose name is now shared are flagged
  _needs review_ (migration 083 backfills the flag) — never re-pointed automatically.
- Report messages for excluded/unsupported fields said "doesn't exist". They now give the
  documented reason without revealing the field's name.
- Standard attributes (job name, projected price, cost-item quantity…) have no JobTread field
  id. Their documented fallback identity is `jobtread:<org>:<entity>:attr:<key>`; no ids are
  invented.

### Model

`jt_field_mappings` (083), one row per `cf:<id>` field and `sem:<key>` alias, unique per
`(organization_id, internal_ref)`: source entity, field id, current name, previous names, type,
mapping status (ok / warning / needs_review / broken / unmapped / stale), sync status (synced /
not_synced / unsupported / stale), exclusion reason, errors, `reporting_enabled`, review state,
last verified. Rows are upserted by each validation (every metadata refresh, or "Revalidate");
nothing is deleted.

### Exclusion reasons

| Reason                | When                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `intentional`         | Excluded under Field access (privacy; values not cached) or turned off for reports       |
| `unsupported_api`     | JobTread rejected `customFieldValues` for the dataset, or the record type has no dataset |
| `not_synced`          | Dataset off / never synced / values not requested / field not yet allowed                |
| `synced_not_exposed`  | Values cached, but the entity isn't a report source (vendors, contacts)                  |
| `permission`          | The viewer's access doesn't include the field's category                                 |
| `broken_mapping`      | Field removed from JobTread, or an alias that's stale / conflicting / ambiguous          |

**Include/exclude:** admins can switch an _eligible_ field (live, synced, in a report source,
not privacy-excluded) off for reports. Its values keep syncing, so switching it back on is
instant. The switch never widens access: field access categories still apply everywhere.

**Validator:** `validateFieldMappings` (`src/lib/reports/field-mapping-core.ts`) is pure and
returns structured results used by the admin UI (`/api/reports/admin/field-mappings`), the
field catalog / engine messages, and Dexter (`reports_field_mappings`). `lookupField` resolves
what a person typed (ref, id, current or former name) to exactly one field, or returns the
ambiguous matches.

## 2. Table formatting

### Audit: why styles were lost

- Columns had **no id**; per-column style was keyed by field ref (`appearance.columns`), so two
  columns of the same field shared a style, and repairing a ref (`sem:x` → `cf:y`) dropped it.
- `update_widget` replaced `appearance` and `columns` wholesale; `set_widget_appearance` merged
  only one level, so styling one column dropped the others.
- **Stale-draft race:** in edit mode with no unsaved edits, a Dexter save reloaded the report but
  not the draft; saving the draft then passed the version check and silently reverted Dexter's
  change.
- `width` and calculation `decimals`/`unit` were accepted but never used.

### Now

- Every table column has a stable `id` (`columns[].id`). Older reports get a deterministic id
  (`job_name`, `job_name_2`, `cf_<id>`) when loaded; the first save stores it. Regenerated
  columns without ids inherit the previous id by field, then label.
- Formatting lives in `appearance.columnFormats[<column id>]`: header and cell colors, bold,
  alignment; number format (currency, percent, decimals, thousands separators, negatives,
  percent input as whole or fraction); width; hidden by default; pin left; conditional cell
  rules (evaluate raw values, optionally another column's). Report presets live in
  `theme.columnPresets`; built-ins in `COLUMN_PRESETS`.
- `update_widget` / `set_widget_appearance` merge per column; new ops `set_column_format`
  (merge / replace / reset) and `prune_column_formats`.
- Edit mode: paintbrush in each column header opens the column editor (color picker with token
  swatches, presets, live preview, reset). Dexter: `reports_format_column` resolves the column by
  label/field/id, returns choices when ambiguous, and writes the same config.
- Deleted columns: their formats are ignored when rendering and reported as stale by the
  integrity check; `prune_column_formats` removes them.
- The editor now saves against the version the draft started from, so a concurrent Dexter save
  is refused instead of overwritten; a clean draft follows Dexter's new version.
- Formatting is display only: values, sorting, search, filters, group math, and CSV exports
  are unchanged (tested).

## 3. Drill-downs

- Click a grouped-table subtotal (or a group's record count) to open the drill drawer:
  breadcrumbs with back navigation, the clicked metric (with its formula for calculated
  fields), reconciliation with the next level, child groups (click to drill further), filters
  kept, and the records with subtotals — paged on the server (`POST /api/reports/<id>/drill`).
- Drill paths follow the table's grouping levels (or the viewer's `group_by` choice). In the
  builder, each table's "Drill" setting chooses records (default), off, or a related source
  reachable through a real stable-id relationship (`jobs.cost_items`,
  `catalog_models.cost_items`). Other targets are rejected when saving.
- Reconciliation: sums and counts must equal the sum of child groups; records with several
  values in a grouping field are reported as overlap. Averages, min/max, distinct counts,
  percentages, and aggregate formulas are recomputed from the group's records, never summed.
- Same authorization as viewing: report permission, field access per column (a restricted
  column can't be drilled and isn't returned), drafts only from editors, templates never read a
  live rule set (this fix also applies to the existing KPI/chart drilldown route).
- JobTread links only for real records (jobs; commission rows link to their job).
- Dexter: `reports_drill` uses the same engine and explains an unavailable relationship.

## 4. Integrity

`auditReportIntegrity` (`GET /api/reports/<id>/integrity`, Dexter `reports_integrity_check`)
runs static checks (missing mappings, invalid / colliding column ids, stale formatting,
invalid drill paths) and executes the report with the requester's access to verify subtotal
reconciliation and that no restricted column is returned.

## Rollout

1. Deploy the code. Reports look the same; legacy columns get ids on load.
2. Apply `083_field_mapping_health.sql`, then Field catalog → Field mapping health →
   Revalidate. Review "Need review" aliases (confirm or choose the field).
3. Rollback: migration 083 only adds a table and can stay. Column formats and drill settings
   are versioned with each report (restore from History).

## Tests

`tests/unit/reporting-mappings-format-drill.test.ts` (mapping rename/delete/duplicate/
unavailable, admin toggle and permissions, formatting persistence and regeneration, Dexter
ambiguity, reconciliation, drill paging/filters/authorization/related sources, integrity,
legacy saved reports, templates) and `tests/unit/report-column-format-ui.test.tsx`. Synthetic
fixture data only; no live JobTread or QuickBooks calls.
