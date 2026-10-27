"use client";

/**
 * Manual widget builder. Produces a widget definition (configuration only) that the
 * server validates when the report is previewed or saved.
 */

import { useCallback, useMemo, useState } from "react";
import { aiFetch, Field, Notice, selectClass, textareaClass, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CHART_TYPES,
  DEFAULT_DATASETS,
  METRIC_OPS,
  widgetSchema,
  type DatasetSpec,
  type ReportSpec,
  type WidgetSpec,
} from "@/lib/reports/spec";
import type { FieldOption, FieldsResponse } from "./types";
import { GroupByPicker } from "./view-controls";

const TYPE_LABELS: Record<string, string> = {
  kpi: "KPI number",
  chart: "Chart",
  table: "Table",
  text: "Text note",
  data_status: "Data status (live)",
  project_header: "Project header",
  detail: "Project details",
  milestones: "Milestone timeline",
  documents: "Documents list",
};
const CHART_LABELS: Record<string, string> = {
  bar: "Bar",
  horizontal_bar: "Horizontal bar",
  stacked_bar: "Stacked bar",
  line: "Line",
  area: "Area",
  donut: "Donut",
  scatter: "Scatter",
  histogram: "Histogram",
};
const OP_LABELS: Record<string, string> = {
  count: "Count",
  count_distinct: "Count distinct",
  sum: "Sum",
  avg: "Average",
  median: "Median",
  min: "Minimum",
  max: "Maximum",
};

function uniqueId(spec: ReportSpec, base: string) {
  const taken = new Set(spec.widgets.map((w) => w.id));
  let i = 1;
  let id = base;
  while (taken.has(id)) id = `${base}_${++i}`;
  return id;
}

export function useFieldOptions() {
  const [fields, setFields] = useState<FieldsResponse | null>(null);
  const load = useCallback(async () => {
    setFields(await aiFetch<FieldsResponse>("/api/reports/fields"));
  }, []);
  useLoad(load);
  return fields;
}

function FieldSelect({
  id,
  value,
  onChange,
  options,
  allowEmpty,
  numericOnly,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { business: FieldOption[]; all: FieldOption[] };
  allowEmpty?: string;
  numericOnly?: boolean;
}) {
  const ok = (f: FieldOption) =>
    !numericOnly || ["number", "currency", "percent", "sqft"].includes(f.type);
  return (
    <select
      id={id}
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty !== undefined ? <option value="">{allowEmpty}</option> : null}
      {options.business.filter(ok).length ? (
        <optgroup label="Business fields">
          {options.business.filter(ok).map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="All fields">
        {options.all.filter(ok).map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export function AddWidgetDialog({
  open,
  onClose,
  spec,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  spec: ReportSpec;
  /** `dataset` is set when the widget needs a data source the report doesn't have yet. */
  onAdd: (w: WidgetSpec, dataset?: DatasetSpec) => void;
}) {
  const fields = useFieldOptions();
  const pickers = spec.controls.filter((c) => c.kind === "job_picker");
  const [type, setType] = useState<WidgetSpec["type"]>("chart");
  const [title, setTitle] = useState("");
  // Reports without data sources (older blank reports) can pick a default one here.
  // The report's datasets plus any default source it doesn't use yet (added on save).
  const datasets = [
    ...spec.datasets,
    ...DEFAULT_DATASETS.filter(
      (d) => !spec.datasets.some((x) => x.source === d.source || x.id === d.id),
    ),
  ];
  const [dataset, setDataset] = useState(datasets[0]?.id ?? "");
  const [chart, setChart] = useState<(typeof CHART_TYPES)[number]>("bar");
  const [op, setOp] = useState<(typeof METRIC_OPS)[number]>("count");
  const [metricField, setMetricField] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [seriesBy, setSeriesBy] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [groupLevels, setGroupLevels] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [control, setControl] = useState(pickers[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const source = datasets.find((d) => d.id === dataset)?.source ?? "jobs";
  const options = fields?.[source] ?? { business: [], all: [] };
  const needsDataset = ["kpi", "chart", "table"].includes(type);
  const needsPicker = ["project_header", "detail", "milestones", "documents"].includes(type);
  const span = useMemo(
    () =>
      type === "kpi"
        ? 3
        : type === "table" || type === "milestones" || type === "project_header"
          ? 12
          : 6,
    [type],
  );

  const submit = () => {
    setError(null);
    const base = {
      id: uniqueId(spec, type === "project_header" ? "header" : type),
      title: title.trim(),
      span,
    };
    const metric = { op, ...(op !== "count" && metricField ? { field: metricField } : {}) };
    let raw: unknown;
    if (type === "kpi") raw = { ...base, type, dataset, metric };
    else if (type === "chart")
      raw =
        chart === "scatter"
          ? { ...base, type, dataset, chart, x: groupBy, y: metricField }
          : {
              ...base,
              type,
              dataset,
              chart,
              groupBy,
              ...(chart === "stacked_bar" && seriesBy ? { seriesBy } : {}),
              metric,
            };
    else if (type === "table")
      raw = {
        ...base,
        type,
        dataset,
        columns: columns.map((field) => ({ field })),
        ...(groupLevels.length ? { groupLevels } : {}),
      };
    else if (type === "text") raw = { ...base, type, body };
    else if (type === "data_status") raw = { ...base, type };
    else if (type === "detail")
      raw = { ...base, type, control, fields: columns.map((field) => ({ field })) };
    else if (type === "project_header")
      raw = { ...base, type, control, fields: columns.slice(0, 8) };
    else raw = { ...base, type, control };
    const parsed = widgetSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue
          ? `${issue.path.join(".") || "Widget"}: ${issue.message}`
          : "This widget isn't complete yet.",
      );
      return;
    }
    const missing =
      needsDataset && !spec.datasets.some((d) => d.id === dataset)
        ? datasets.find((d) => d.id === dataset)
        : undefined;
    onAdd(parsed.data, missing);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Add a widget</DialogTitle>
        <DialogCloseButton />
      </DialogHeader>
      <DialogBody className="space-y-4">
        {!fields ? <p className="text-sm text-[var(--acton-muted)]">Loading fields…</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="wb-type">
            <select
              id="wb-type"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as WidgetSpec["type"])}
            >
              {Object.entries(TYPE_LABELS)
                .filter(
                  ([k]) =>
                    !["project_header", "detail", "milestones", "documents"].includes(k) ||
                    pickers.length,
                )
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Title" htmlFor="wb-title">
            <Input
              id="wb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Projects by phase"
            />
          </Field>
          {needsDataset ? (
            <Field label="Data" htmlFor="wb-dataset">
              <select
                id="wb-dataset"
                className={selectClass}
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label ?? d.id}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {needsPicker ? (
            <Field label="Project picker" htmlFor="wb-control">
              <select
                id="wb-control"
                className={selectClass}
                value={control}
                onChange={(e) => setControl(e.target.value)}
              >
                {pickers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {type === "chart" ? (
            <Field label="Chart type" htmlFor="wb-chart">
              <select
                id="wb-chart"
                className={selectClass}
                value={chart}
                onChange={(e) => setChart(e.target.value as (typeof CHART_TYPES)[number])}
              >
                {CHART_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {CHART_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {type === "chart" ? (
            <Field
              label={
                chart === "scatter" ? "X axis" : chart === "histogram" ? "Number field" : "Group by"
              }
              htmlFor="wb-group"
            >
              <FieldSelect
                id="wb-group"
                value={groupBy}
                onChange={setGroupBy}
                options={options}
                allowEmpty="Choose a field"
                numericOnly={chart === "scatter" || chart === "histogram"}
              />
            </Field>
          ) : null}
          {type === "chart" && chart === "stacked_bar" ? (
            <Field label="Split by" htmlFor="wb-series">
              <FieldSelect
                id="wb-series"
                value={seriesBy}
                onChange={setSeriesBy}
                options={options}
                allowEmpty="Choose a field"
              />
            </Field>
          ) : null}
          {type === "kpi" || (type === "chart" && chart !== "scatter" && chart !== "histogram") ? (
            <Field label="Measure" htmlFor="wb-op">
              <select
                id="wb-op"
                className={selectClass}
                value={op}
                onChange={(e) => setOp(e.target.value as (typeof METRIC_OPS)[number])}
              >
                {METRIC_OPS.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABELS[o]}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {(type === "kpi" || type === "chart") &&
          (op !== "count" || chart === "scatter") &&
          chart !== "histogram" ? (
            <Field
              label={chart === "scatter" && type === "chart" ? "Y axis" : "Of field"}
              htmlFor="wb-metric"
            >
              <FieldSelect
                id="wb-metric"
                value={metricField}
                onChange={setMetricField}
                options={options}
                allowEmpty="Choose a field"
                numericOnly={op !== "count_distinct"}
              />
            </Field>
          ) : null}
        </div>
        {type === "table" || type === "detail" || type === "project_header" ? (
          <Field
            label={type === "table" ? "Columns" : "Fields"}
            help="Pick fields in the order you want them shown."
          >
            <div className="max-h-64 overflow-auto rounded-md border border-[var(--acton-border)] p-2">
              {[
                ...options.business,
                ...options.all.filter((f) => !options.business.some((b) => b.origin === f.origin)),
              ].map((f) => (
                <label
                  key={f.key}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                  title={f.origin}
                >
                  <input
                    type="checkbox"
                    checked={columns.includes(f.key)}
                    onChange={(e) =>
                      setColumns((c) =>
                        e.target.checked ? [...c, f.key] : c.filter((x) => x !== f.key),
                      )
                    }
                  />
                  {f.label}
                  {f.key.startsWith("sem:") ? (
                    <span className="text-xs text-[var(--acton-muted)]">business field</span>
                  ) : null}
                </label>
              ))}
            </div>
          </Field>
        ) : null}
        {type === "table" ? (
          <Field
            label="Group rows by (optional)"
            help="Nested, expandable groups with subtotals — e.g. Phase, then Project Manager, then Job. Use the arrows to change the order."
          >
            <GroupByPicker
              id="wb-group-levels"
              options={{
                kind: "group_by",
                id: "builder",
                maxLevels: 4,
                selected: groupLevels,
                options: [...options.business, ...options.all]
                  .filter(
                    (f, i, all) =>
                      !["currency", "number", "percent"].includes(f.type) &&
                      all.findIndex((x) => x.key === f.key) === i,
                  )
                  .map((f) => ({ value: f.key, label: f.label })),
              }}
              value={groupLevels}
              onChange={setGroupLevels}
            />
          </Field>
        ) : null}
        {type === "text" ? (
          <Field label="Text" htmlFor="wb-body">
            <textarea
              id="wb-body"
              className={textareaClass}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit}>Add widget</Button>
      </DialogFooter>
    </Dialog>
  );
}
