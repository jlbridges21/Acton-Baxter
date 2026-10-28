# JobTread field catalog, business-name audit, and report styling

## Field catalog (Reports → Data settings → Field catalog)

- **Identity.** A JobTread field is identified by its immutable JobTread id: `cf:<id>` in report
  specs, and `jobtread:<organization>:<entity>:<id>` as its tenant-qualified source reference.
  Labels are never identity. Reports show the field's current JobTread name at run time, so a
  rename in JobTread needs no code change or remapping.
- **Discovery.** Every metadata refresh (each JobTread sync, or "Refresh now") reads JobTread's
  `customFields` for all entities (job, location, customer, customerContact, vendor,
  vendorContact, dailyLog, costItem — JobTread's canonical `targetType` values). New fields
  appear automatically; renames, type changes, option changes, removals, and restorations are
  recorded in `jt_custom_field_history`.
- **Removals.** A field missing from JobTread's response becomes _stale_ (kept with
  `removed_at`, history intact). If a response is empty, or would remove more than half of the
  active fields (and more than five), removals are **held** and the refresh is marked `held`;
  an administrator confirms them with "Confirm removals". A failed refresh changes nothing.
- **Statuses.** active (usable in reports), excluded (an administrator excluded it), unsupported
  (its entity has no report source yet — contacts, vendors, daily logs, cost-item custom
  fields), stale (removed from JobTread).
- **Visibility vs. access.** Administrators see every field with its status. Everyone else sees
  only reportable fields in categories they can access — excluded and unsupported fields
  (including their names) are not shown. Field access is still set under Data settings →
  Field access; the catalog never widens it. Every engine path (reports, previews, drilldowns,
  exports, Dexter tools, conditional styling) checks field access server-side.
- **Standard fields** (job name, projected price, cost-item fields, …) are listed with the
  custom fields.

## Business names (sem:…) — optional aliases

Business names are optional shortcuts to native fields. The alias audit checks each one by
field id against its declaration (business-fields spreadsheet name/entity/type, or the
built-in vocabulary):

| Status      | Meaning                                                                                            | What happens                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ok          | Points at the declared/honestly named field                                                        | Resolves normally                                                                                 |
| conflict    | Its declaration has exactly one verified exact match, but it points elsewhere                      | Not used (clear message); "Point at …" applies the certain repair                                 |
| ambiguous   | Points at a shared narrative field while several typed fields could be meant                       | Not used; an administrator chooses — never guessed                                                |
| shared_text | Presents a narrative text field under a structured-sounding name, or shares it with other meanings | Still resolves for compatibility, with a visible warning; reports should use the native `cf:` ref |
| stale       | Its field was removed from JobTread                                                                | Not used; repair by remapping                                                                     |
| deprecated  | An administrator retired it                                                                        | Resolves with a warning                                                                           |

Repairs are explicit, audited, and previewed (affected reports listed). Values embedded in
narrative fields are never parsed or presented as structured fields; if a value is reported
often, create a dedicated JobTread custom field — it appears automatically.

## Report audit and repair

The audit checks every reference in every report (columns, filters, sorts, grouping levels,
controls, calculations including formula text, relationships, color bindings), saved personal
views, and Metric Library metrics. Unavailable fields never break a report: the affected
column, KPI, or chart shows a reason and the rest renders.

Automatic repair suggestions are offered only when identity is certain: a business name that
reads a shared field is replaced by that same field's native reference (identical values,
honest label); duplicates created by the replacement are removed. Anything else needs an
explicit choice. Applying a repair saves a new report version; restore the previous version
from History to undo. Previous versions are never rewritten.

## Report styling

Optional, validated, and versioned with the report. A report with no `theme` and widgets with
no `appearance` render exactly as before.

- **Report `theme`:** `palette` (default, acton — the app's brand navy/yellow tokens —, slate,
  high_contrast), `tokens` (background, surface, text, muted, border, accent, positive,
  warning, negative, info, neutral), `chart.categorical` / `chart.sequential`, `typography`
  (sm/md/lg), `density` (compact/default/comfortable), `spacing` (tight/default/loose), `card`
  (default/flat/outlined/elevated), `categoryColors` (per field: value → color, shared by every
  chart), `statusColors` (value → color), `nullColor`.
- **Widget `appearance`:** card, typography, density, titleAlign, hideTitle (plus `subtitle` on
  every widget). KPI: accent, background, valueColor, align, rules. Chart: palette,
  seriesColors, categoryColors, legend {show, position}, axis {x, y: {show, label}, grid},
  rules (point value, or label with `target: "category"`). Table: header, zebra, dividers,
  groupHeader, subtotal, columns {field: {align}}, controls {search, columns, expandAll,
  collapseAll, expandToLevel}, rules (row field).
- **Colors** are `#rrggbb` (`#abc` is expanded) or `token:<name>`. Names, CSS, URLs,
  transparency, and unknown keys are rejected with path-aware messages. Low-contrast choices
  produce warnings (WCAG 4.5:1), not errors.
- **Stable colors.** With a theme or appearance, category colors come from explicit bindings
  (widget, report field, status colors), then a deterministic hash of the value into the
  palette — a value keeps its color across filters, sorting, and pages. Blank → null color.
- **Rules** use the report filter operators plus `between`; first match wins. Table rules are
  evaluated on the server with the viewer's field access, so a rule can't reveal hidden data.
- Grouped-table buttons hidden by `controls` only affect presentation; viewers' expand state
  and access checks are unchanged.
- Editors: "Style" in edit mode (palette, density, spacing, text size, cards; per widget
  card/text size, chart palette and legend, table look and buttons). Dexter sets everything,
  including value colors and rules, with `set_theme`, `set_widget_appearance`, and dry runs.

## Dexter

New tools: `reports_fields` (native catalog search), `reports_catalog_audit`,
`reports_field_impact`, `reports_field_repair` (dry-run by default). `reports_update` accepts
`dryRun: true` and the ops `set_theme`, `remove_theme`, `set_widget_appearance`,
`remove_widget_appearance`. A one-time seed step ("System: Dexter field catalog and styling")
enables the new tools on Dexter's published config. The agent tool limit was raised from 40 to
80 enabled tools.

## Rollout and rollback

1. Deploy the code: report output is unchanged except that the two misresolving aliases (a
   conflict and an ambiguity) now show a clear "can't be used" message instead of the wrong
   field, and shared-text aliases show a warning.
2. Apply `080_field_catalog.sql` (additive). Refresh the catalog (Field catalog → Refresh now).
3. Review "Business names needing attention"; apply the certain repairs; choose the field for
   ambiguous ones.
4. Preview report repairs; apply only the ones you accept (new versions).
5. Rollback: restore previous report versions; remap an alias back; styling can be removed
   with "Reset all to default" or `remove_theme`. Migration 080 adds columns/tables only and can
   stay in place.
