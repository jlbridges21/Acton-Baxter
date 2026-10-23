# Reports: specification and renderer

## 7. Report specification schema

Source of truth: `src/lib/reports/spec.ts` (Zod, schema version 1). A report is
configuration only — unknown widget types and properties are rejected or stripped, so a spec
can't carry HTML, scripts, or expressions.

```jsonc
{
  "schemaVersion": 1,
  "title": "Active Projects",
  "description": "…",
  "datasets": [
    {
      "id": "active_jobs",
      "source": "jobs",
      "label": "Active projects",
      "filters": [{ "field": "sem:phase", "op": "in", "value": ["BR-Design", "BR-Permitting"] }],
    },
  ],
  "controls": [
    // report-level filters shown above the widgets
    {
      "id": "pm",
      "kind": "select",
      "label": "Project manager",
      "field": "sem:project_manager",
      "datasets": ["active_jobs"],
    },
  ],
  "widgets": [
    // order = layout order on a 12-column grid
    {
      "id": "count",
      "type": "kpi",
      "title": "Active projects",
      "span": 3,
      "dataset": "active_jobs",
      "metric": { "op": "count" },
    },
    {
      "id": "by_pm",
      "type": "chart",
      "chart": "donut",
      "dataset": "active_jobs",
      "groupBy": "sem:project_manager",
    },
  ],
}
```

- **Sources:** `jobs`, `catalog_models`.
- **Operators:** eq, neq, in, not_in, contains, not_contains, starts_with, blank, not_blank,
  gt, gte, lt, lte.
- **Metrics:** count, count_distinct, sum, avg, median, min, max.
- **Controls:** `job_picker` (choose one project), `select` (multi-select with counts),
  `search`, `number_range`, `date_range`.
- **Widgets:** `kpi`, `chart` (bar, horizontal_bar, stacked_bar, line, area, donut, scatter,
  histogram), `table` (columns, sort, paging, search, highlights, row drilldown, comparison),
  `project_header`, `detail` (grid, long_text, badges), `milestones` (timeline or list;
  schedule, checklists, or both), `documents`, `text`. Common: `span` 3/4/6/8/12,
  `height`, `hidden`.
- **Formats:** auto, text, number, currency, percent (values 0–100), date, sqft, boolean, list.
- Structural checks (`checkSpecReferences`): unique ids, datasets/controls exist, project
  widgets point at a job picker, charts have a group-by, non-count metrics have a field.
  Field existence and access are checked on the server against the live field catalog.
- **Structured edits** (`src/lib/reports/ops.ts`): set_title, set_description, add_widget,
  update_widget, remove_widget, move_widget, reorder_widgets, add_dataset,
  set_dataset_filters, add_control, update_control, remove_control. The result is
  re-validated as a whole; one bad operation rejects the batch.

Calculation rules (`src/lib/reports/compute.ts`): blanks are excluded from sum/avg/min/max/median
and reported ("3 with a value"); blank group values appear as "(blank)"; multi-value fields
count under each value (and the provenance says so); groups beyond the chart's limit fold
into "Other (n)" which re-aggregates the underlying rows (so averages stay correct); currency
sums are rounded to avoid float noise.

## 8. Dashboard renderer

- `/reports/[id]` → `ReportView` (`src/components/report-builder/report-view.tsx`) calls
  `POST /api/reports/[id]/execute` with the filter state; the server returns only computed,
  authorized results (`src/lib/reports/result-types.ts`).
- Widgets (`widgets.tsx`): KPI cards (click → records), Recharts charts with hover tooltips
  (value, record count, "click to see the records"), click-to-drill on bars/segments, a
  "Show as table" view for every chart, TanStack tables (sort, search, paging, highlighted
  rows, row detail drawer, side-by-side comparison of up to 4 rows), project header with
  "Open in JobTread", detail grids, milestone timeline (bars by date, today marker), document
  lists by folder.
- Every data widget has **ⓘ How this is calculated** (source, fields with JobTread origin,
  filters, calculation, record counts, notes) and **Download CSV** (formula-injection safe).
- Filters live in the URL (`?f=…`) so a filtered view can be bookmarked or shared.
- **Edit layout:** drag to reorder (dnd-kit, keyboard accessible), width, height, chart type,
  rename, hide, remove, add widgets (builder lists only fields the editor may see). Changes
  preview live, undo/redo (⌘Z / ⇧⌘Z), and save as a new version (stale saves are rejected).
- Print / save as PDF uses print styles (nav, buttons, and chat hidden).
- Charts use a validated categorical palette in fixed order with "Other" in gray; legends use
  text color; count axes use whole numbers.
