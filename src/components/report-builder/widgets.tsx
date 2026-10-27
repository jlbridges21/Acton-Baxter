"use client";

/**
 * Trusted renderers for every report widget type. Widgets receive already-computed,
 * already-authorized results from the server; nothing here calculates business numbers
 * beyond display formatting, sorting, and paging.
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  FileText,
  Folder,
  Info,
  Lock,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CellValue } from "@/lib/reports/compute";
import { formatRelative } from "@/components/ai/ui";
import type {
  ChartResult,
  DataStatusResult,
  DetailResult,
  DocumentsResult,
  FieldMeta,
  HeaderResult,
  KpiResult,
  MilestonesResult,
  Provenance,
  TableResult,
  WidgetResult,
} from "@/lib/reports/result-types";
import type { WidgetSpec } from "@/lib/reports/spec";
import {
  compareCells,
  formatAxis,
  formatValue,
  resolveDisplayType,
  type DisplayType,
} from "./format";
import { ColumnsMenu, GroupedTable, useViewerPref } from "./grouped-table";
import { RuleEditorWidget } from "./rule-editors";

/** Categorical slots in fixed order (validated reference palette, light surface). */
export const SERIES_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];
const OTHER_COLOR = "#a3acb8";
const SINGLE_COLOR = "#2a78d6";
const GRID = "#e8edf3";
const AXIS_TEXT = "#5b6b7c";

/** Legend labels wear text ink; the swatch beside them carries the identity. */
const legendText = (value: string) => <span style={{ color: "#0b1f3a" }}>{value}</span>;

const HEIGHTS = { sm: 200, md: 280, lg: 380, auto: 280 } as const;

export type DrillRequest = {
  widgetId: string;
  groupKey?: string | null;
  seriesKey?: string | null;
  title: string;
};

export type WidgetActions = {
  onDrill?: (req: DrillRequest) => void;
  onOpenRow?: (
    row: { id: string; cells: Record<string, CellValue>; jobtreadUrl?: string },
    columns: FieldMeta[],
  ) => void;
  /** Business-rule editors changed something; re-run the report. */
  onRulesChanged?: () => void;
};

// ---------------------------------------------------------------------------
// Frame, provenance, statuses
// ---------------------------------------------------------------------------

export function ProvenanceButton({
  provenance,
  title,
}: {
  provenance?: Provenance;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  if (!provenance) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] hover:text-[var(--acton-navy)] print:hidden"
        aria-label={`How "${title || "this widget"}" is calculated`}
        title="How this is calculated"
      >
        <Info className="h-4 w-4" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader>
          <DialogTitle>How this is calculated</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="space-y-3 text-sm text-[var(--acton-navy)]">
          <p>
            <span className="font-semibold">Calculation:</span> {provenance.calculation}
          </p>
          <p>
            <span className="font-semibold">Source:</span> {provenance.source}
          </p>
          <p>
            <span className="font-semibold">Records:</span> {provenance.rows.toLocaleString()}
            {provenance.withValue !== undefined
              ? ` (${provenance.withValue.toLocaleString()} with a value)`
              : ""}
          </p>
          {provenance.fields.length ? (
            <div>
              <p className="font-semibold">Fields</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--acton-muted)]">
                {provenance.fields.map((f) => (
                  <li key={f.key}>
                    <span className="font-medium text-[var(--acton-navy)]">{f.label}</span> —{" "}
                    {f.origin}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {provenance.filters.length ? (
            <div>
              <p className="font-semibold">Filters applied</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--acton-muted)]">
                {provenance.filters.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {provenance.notes.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--acton-muted)]">
              {provenance.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
      </Dialog>
    </>
  );
}

function StatusMessage({ result }: { result: WidgetResult }) {
  if (result.status === "restricted") {
    return (
      <div className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-md bg-[var(--acton-gray-50)] p-3 text-center text-sm text-[var(--acton-muted)]">
        <Lock className="h-5 w-5" aria-hidden />
        <p>{result.message ?? "This widget uses data your access level doesn't include."}</p>
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div
        role="alert"
        className="flex min-h-24 items-center justify-center rounded-md border border-red-200 bg-red-50 p-4 text-center text-sm text-red-900"
      >
        {result.message ?? "This widget couldn't be calculated."}
      </div>
    );
  }
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md bg-[var(--acton-gray-50)] p-4 text-center text-sm text-[var(--acton-muted)]">
      {result.message ?? "No matching records."}
    </div>
  );
}

export function WidgetBody({
  spec,
  result,
  actions,
}: {
  spec: WidgetSpec;
  result: WidgetResult | undefined;
  actions: WidgetActions;
}) {
  if (!result)
    return (
      <div
        className="h-24 animate-pulse rounded-md bg-[var(--acton-gray-50)]"
        aria-label="Loading"
      />
    );
  if (result.status === "restricted" || result.status === "error")
    return <StatusMessage result={result} />;
  switch (result.kind) {
    case "kpi":
      return <KpiWidget spec={spec} result={result} actions={actions} />;
    case "chart":
      return result.status === "empty" ? (
        <StatusMessage result={result} />
      ) : (
        <ChartWidget spec={spec} result={result} actions={actions} />
      );
    case "table":
      return result.status === "empty" ? (
        <StatusMessage result={result} />
      ) : (
        <TableWidget spec={spec} result={result} actions={actions} />
      );
    case "detail":
      return <DetailWidget spec={spec} result={result} />;
    case "project_header":
      return <HeaderWidget result={result} />;
    case "milestones":
      return result.status === "empty" ? (
        <StatusMessage result={result} />
      ) : (
        <MilestonesWidget spec={spec} result={result} />
      );
    case "documents":
      return result.status === "empty" ? (
        <StatusMessage result={result} />
      ) : (
        <DocumentsWidget spec={spec} result={result} />
      );
    case "text":
      return <p className="text-sm whitespace-pre-wrap text-[var(--acton-muted)]">{result.body}</p>;
    case "rule_editor":
      return <RuleEditorWidget result={result} onChanged={() => actions.onRulesChanged?.()} />;
    case "data_status":
      return <DataStatusWidget result={result} />;
  }
}

const FRESHNESS_TONE: Record<string, string> = {
  fresh: "bg-emerald-500",
  running: "bg-indigo-500",
  stale: "bg-amber-500",
  failed: "bg-red-500",
  never: "bg-slate-400",
  disabled: "bg-slate-400",
  not_configured: "bg-slate-400",
};

function DataStatusWidget({ result }: { result: DataStatusResult }) {
  if (!result.datasets.length) return <StatusMessage result={result} />;
  return (
    <ul className="divide-y divide-[var(--acton-gray-100)] text-sm">
      {result.datasets.map((d) => (
        <li key={d.entity} className="flex items-start gap-2 py-1.5">
          <span
            className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", FRESHNESS_TONE[d.level])}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-[var(--acton-navy)]">{d.label}</span>
            <span className="text-[var(--acton-muted)]">
              {" "}
              · {d.lastSuccessAt ? `synced ${formatRelative(d.lastSuccessAt)}` : "never synced"}
            </span>
            {d.message ? <span className="block text-xs text-amber-900">{d.message}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

function KpiWidget({
  spec,
  result,
  actions,
}: {
  spec: WidgetSpec;
  result: KpiResult;
  actions: WidgetActions;
}) {
  const type = resolveDisplayType(spec.type === "kpi" ? spec.format : undefined, result.fieldType);
  const canDrill = spec.type === "kpi" && spec.drilldown && actions.onDrill;
  const value = (
    <span className="text-3xl font-bold tracking-tight text-[var(--acton-navy)] tabular-nums">
      {formatValue(result.value, type)}
    </span>
  );
  return (
    <div>
      {canDrill ? (
        <button
          type="button"
          className="rounded text-left hover:underline focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
          onClick={() => actions.onDrill!({ widgetId: spec.id, title: spec.title || "Records" })}
          title="Show the records behind this number"
        >
          {value}
        </button>
      ) : (
        value
      )}
      {result.label ? (
        <p className="mt-0.5 text-xs font-semibold text-[var(--acton-muted)]">{result.label}</p>
      ) : null}
      {result.provenance ? (
        <p className="mt-1 text-xs text-[var(--acton-muted)]">
          {result.provenance.rows.toLocaleString()} record{result.provenance.rows === 1 ? "" : "s"}
          {result.provenance.withValue !== undefined &&
          result.provenance.withValue < result.provenance.rows
            ? ` · ${result.provenance.withValue.toLocaleString()} with a value`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

type TooltipPayload = {
  payload?: Record<string, unknown>;
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
};

function ChartTooltip({
  active,
  payload,
  label,
  valueType,
  metricLabel,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  valueType: DisplayType;
  metricLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload ?? {};
  const count = typeof point.count === "number" ? point.count : null;
  return (
    <div className="rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-[var(--acton-navy)]">
        {String(point.key ?? label ?? "")}
      </p>
      {payload.map((p) => (
        <p
          key={String(p.dataKey ?? p.name)}
          className="flex items-center gap-2 text-[var(--acton-navy)]"
        >
          {payload.length > 1 ? (
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          ) : null}
          <span className="text-[var(--acton-muted)]">
            {payload.length > 1 ? p.name : metricLabel}:
          </span>
          <span className="font-semibold tabular-nums">
            {formatValue(typeof p.value === "number" ? p.value : null, valueType)}
          </span>
        </p>
      ))}
      {count !== null && valueType !== "count" ? (
        <p className="mt-1 text-[var(--acton-muted)]">{count.toLocaleString()} records</p>
      ) : null}
      <p className="mt-1 text-[var(--acton-muted)] print:hidden">Click to see the records</p>
    </div>
  );
}

/** Keep at most 8 identities colored; the rest fold into one gray "Other" slot. */
function colorFor(index: number, isOther?: boolean) {
  return isOther || index >= SERIES_COLORS.length ? OTHER_COLOR : SERIES_COLORS[index]!;
}

function ChartWidget({
  spec,
  result,
  actions,
}: {
  spec: WidgetSpec;
  result: ChartResult;
  actions: WidgetActions;
}) {
  const chartSpec = spec.type === "chart" ? spec : null;
  const height = HEIGHTS[spec.height];
  const valueType = resolveDisplayType(chartSpec?.format, result.valueType);
  const [showTable, setShowTable] = useState(false);
  const drill = (groupKey: string | null, seriesKey?: string | null) => {
    if (!chartSpec?.drilldown || !actions.onDrill || !groupKey) return;
    actions.onDrill({
      widgetId: spec.id,
      groupKey,
      seriesKey: seriesKey ?? null,
      title: spec.title,
    });
  };
  const data = result.points.map((p) => ({ ...p, ...(p.series ?? {}) }));
  const tooltip = (
    <Tooltip
      content={<ChartTooltip valueType={valueType} metricLabel={result.metricLabel} />}
      cursor={{ fill: "rgba(11,31,58,0.05)" }}
    />
  );
  const axisProps = {
    tick: { fill: AXIS_TEXT, fontSize: 11 },
    axisLine: { stroke: GRID },
    tickLine: false,
  };
  // Counts are whole numbers; don't draw 0.5-record ticks.
  const valueAxis = { ...axisProps, allowDecimals: valueType !== "count" };
  const series = result.seriesKeys;
  const kind = chartSpec?.chart ?? "bar";

  let chart: React.ReactNode;
  if (kind === "donut") {
    chart = (
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="key"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={1}
          stroke="#ffffff"
          strokeWidth={2}
          onClick={(_: unknown, i: number) => drill(data[i]?.key ?? null)}
          className="cursor-pointer"
          isAnimationActive={false}
        >
          {data.map((p, i) => (
            <Cell key={p.key} fill={colorFor(i, p.isOther)} />
          ))}
        </Pie>
        {tooltip}
        <Legend
          formatter={legendText}
          verticalAlign="middle"
          align="right"
          layout="vertical"
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: "#0b1f3a" }}
        />
      </PieChart>
    );
  } else if (kind === "scatter") {
    chart = (
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          type="number"
          dataKey="x"
          name={result.xLabel}
          {...axisProps}
          tickFormatter={(v: number) => formatAxis(v, "number")}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={result.yLabel}
          {...axisProps}
          width={56}
          tickFormatter={(v: number) => formatAxis(v, "number")}
        />
        <Tooltip
          content={({ active, payload }) => {
            const p = (payload?.[0]?.payload ?? null) as {
              label: string;
              x: number;
              y: number;
            } | null;
            if (!active || !p) return null;
            return (
              <div className="rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-[var(--acton-navy)]">{p.label}</p>
                <p>
                  {result.xLabel}: {formatValue(p.x, "number")}
                </p>
                <p>
                  {result.yLabel}: {formatValue(p.y, "number")}
                </p>
              </div>
            );
          }}
        />
        <Scatter
          data={result.scatter ?? []}
          fill={SINGLE_COLOR}
          stroke="#ffffff"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </ScatterChart>
    );
  } else if (kind === "line" || kind === "area") {
    const Chart = kind === "line" ? LineChart : AreaChart;
    chart = (
      <Chart
        data={data}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        onClick={(e: { activeLabel?: string | number }) =>
          drill(e?.activeLabel != null ? String(e.activeLabel) : null)
        }
      >
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="key" {...axisProps} />
        <YAxis {...valueAxis} width={56} tickFormatter={(v: number) => formatAxis(v, valueType)} />
        <Tooltip
          content={<ChartTooltip valueType={valueType} metricLabel={result.metricLabel} />}
        />
        {series.length ? (
          <Legend formatter={legendText} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        ) : null}
        {(series.length ? series : ["value"]).map((k, i) =>
          kind === "line" ? (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={series.length ? k : result.metricLabel}
              stroke={series.length ? colorFor(i) : SINGLE_COLOR}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, fill: "#ffffff" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ) : (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              name={series.length ? k : result.metricLabel}
              stackId={series.length ? "a" : undefined}
              stroke={series.length ? colorFor(i) : SINGLE_COLOR}
              fill={series.length ? colorFor(i) : SINGLE_COLOR}
              fillOpacity={0.18}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ),
        )}
      </Chart>
    );
  } else {
    const horizontal = kind === "horizontal_bar";
    const stacked = series.length > 0;
    chart = (
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        barCategoryGap="20%"
      >
        <CartesianGrid stroke={GRID} horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              {...valueAxis}
              tickFormatter={(v: number) => formatAxis(v, valueType)}
            />
            <YAxis
              type="category"
              dataKey="key"
              {...axisProps}
              width={140}
              interval={0}
              tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="key"
              {...axisProps}
              interval={0}
              tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
            />
            <YAxis
              {...valueAxis}
              width={56}
              tickFormatter={(v: number) => formatAxis(v, valueType)}
            />
          </>
        )}
        {tooltip}
        {stacked ? (
          <Legend formatter={legendText} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        ) : null}
        {stacked ? (
          series.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              name={k}
              stackId="a"
              fill={colorFor(i, k.startsWith("Other ("))}
              stroke="#ffffff"
              strokeWidth={1}
              className="cursor-pointer"
              onClick={(d: { payload?: { key?: string } }) => drill(d.payload?.key ?? null, k)}
              isAnimationActive={false}
            />
          ))
        ) : (
          <Bar
            dataKey="value"
            name={result.metricLabel}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={48}
            className="cursor-pointer"
            onClick={(d: { payload?: { key?: string } }) => drill(d.payload?.key ?? null)}
            isAnimationActive={false}
          >
            {data.map((p) => (
              <Cell key={p.key} fill={p.isOther ? OTHER_COLOR : SINGLE_COLOR} />
            ))}
          </Bar>
        )}
      </BarChart>
    );
  }

  return (
    <div>
      <div
        style={{
          height: kind === "horizontal_bar" ? Math.max(height, data.length * 28 + 40) : height,
        }}
        className={cn(showTable && "hidden")}
      >
        <ResponsiveContainer width="100%" height="100%">
          {chart as React.ReactElement}
        </ResponsiveContainer>
      </div>
      {showTable ? <ChartDataTable result={result} valueType={valueType} /> : null}
      <div className="mt-1 flex justify-end print:hidden">
        <button
          type="button"
          className="text-xs font-medium text-[var(--acton-muted)] hover:text-[var(--acton-navy)] hover:underline"
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Show chart" : "Show as table"}
        </button>
      </div>
    </div>
  );
}

function ChartDataTable({ result, valueType }: { result: ChartResult; valueType: DisplayType }) {
  if (result.scatter) {
    return (
      <SimpleTable
        headers={["Record", result.xLabel ?? "X", result.yLabel ?? "Y"]}
        rows={result.scatter.map((p) => [
          p.label,
          formatValue(p.x, "number"),
          formatValue(p.y, "number"),
        ])}
      />
    );
  }
  const series = result.seriesKeys;
  return (
    <SimpleTable
      headers={[result.groupLabel, ...(series.length ? series : [result.metricLabel]), "Records"]}
      rows={result.points.map((p) => [
        p.key,
        ...(series.length
          ? series.map((s) => formatValue(p.series?.[s] ?? null, valueType))
          : [formatValue(p.value, valueType)]),
        p.count.toLocaleString(),
      ])}
    />
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-[var(--acton-border)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--acton-gray-100)]">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn("px-3 py-1.5 text-[var(--acton-navy)]", j > 0 && "tabular-nums")}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  green: "bg-emerald-50",
  amber: "bg-amber-50",
  red: "bg-red-50",
  blue: "bg-sky-50",
  gray: "bg-slate-50",
};

type TableRowData = TableResult["rows"][number];

function TableWidget({
  spec,
  result,
  actions,
}: {
  spec: WidgetSpec;
  result: TableResult;
  actions: WidgetActions;
}) {
  if (result.groups) {
    return (
      <GroupedTable
        widgetId={spec.id}
        result={result}
        onOpenRow={
          spec.type === "table" && spec.rowDrilldown && actions.onOpenRow
            ? actions.onOpenRow
            : undefined
        }
      />
    );
  }
  return <FlatTable spec={spec} result={result} actions={actions} />;
}

function FlatTable({
  spec,
  result,
  actions,
}: {
  spec: WidgetSpec;
  result: TableResult;
  actions: WidgetActions;
}) {
  const tableSpec = spec.type === "table" ? spec : null;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [hiddenColumns, setHiddenColumns] = useViewerPref<string[]>(
    `baxter.report.columns:${typeof window === "undefined" ? "" : window.location.pathname}:${spec.id}`,
    [],
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const comparable = Boolean(tableSpec?.comparable);

  const columns = useMemo<ColumnDef<TableRowData>[]>(
    () => [
      ...(comparable
        ? [
            {
              id: "__select",
              header: () => <span className="sr-only">Select to compare</span>,
              enableSorting: false,
              cell: ({ row }: { row: { original: TableRowData } }) => (
                <input
                  type="checkbox"
                  aria-label="Select to compare"
                  checked={selected.includes(row.original.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked
                        ? [...s, row.original.id].slice(-4)
                        : s.filter((x) => x !== row.original.id),
                    )
                  }
                />
              ),
            } satisfies ColumnDef<TableRowData>,
          ]
        : []),
      ...result.columns.map((c): ColumnDef<TableRowData> => ({
        id: c.key,
        header: c.label,
        accessorFn: (r) => r.cells[c.key] ?? null,
        sortingFn: (a, b) => compareCells(a.original.cells[c.key], b.original.cells[c.key]),
        filterFn: "includesString",
        cell: ({ row }) => formatValue(row.original.cells[c.key], c.type),
      })),
    ],
    [result.columns, comparable, selected],
  );

  const table = useReactTable({
    data: result.rows,
    columns,
    state: {
      sorting,
      globalFilter: search,
      columnVisibility: Object.fromEntries(hiddenColumns.map((k) => [k, false])),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, value: string) => {
      const q = value.trim().toLowerCase();
      if (!q) return true;
      return result.columns.some((c) => {
        const v = row.original.cells[c.key];
        return (
          v !== null &&
          v !== undefined &&
          String(Array.isArray(v) ? v.join(" ") : v)
            .toLowerCase()
            .includes(q)
        );
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: tableSpec?.pageSize ?? 25 } },
  });

  const rows = table.getRowModel().rows;
  const clickable = Boolean(tableSpec?.rowDrilldown && actions.onOpenRow);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {tableSpec?.searchable !== false ? (
          <label className="relative block w-full max-w-xs">
            <span className="sr-only">Search this table</span>
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-[var(--acton-muted)]"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rows"
              className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white pr-3 pl-8 text-sm"
            />
          </label>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 text-xs text-[var(--acton-muted)]">
          {result.columns.length > 3 ? (
            <ColumnsMenu
              columns={result.columns}
              hidden={hiddenColumns}
              onChange={setHiddenColumns}
            />
          ) : null}
          {comparable ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={selected.length < 2}
              onClick={() => setComparing(true)}
            >
              Compare {selected.length ? `(${selected.length})` : ""}
            </Button>
          ) : null}
          <span>
            {table.getFilteredRowModel().rows.length.toLocaleString()} of{" "}
            {result.totalRows.toLocaleString()} rows
            {result.truncated ? " (first 1,000 shown)" : ""}
          </span>
        </div>
      </div>
      {result.message ? (
        <p className="text-xs text-[var(--acton-muted)]">{result.message}</p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-[var(--acton-border)]">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-[var(--acton-gray-50)] text-left text-xs text-[var(--acton-muted)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const meta = result.columns.find((c) => c.key === h.column.id);
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      className="px-3 py-2 font-semibold whitespace-nowrap"
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {h.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-[var(--acton-navy)]"
                          onClick={h.column.getToggleSortingHandler()}
                          title={meta?.description ?? meta?.origin}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          ) : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-t border-[var(--acton-gray-100)]",
                  row.original.tone ? TONES[row.original.tone] : null,
                  clickable && "cursor-pointer hover:bg-[var(--acton-gray-50)]",
                )}
                onClick={
                  clickable ? () => actions.onOpenRow!(row.original, result.columns) : undefined
                }
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => e.key === "Enter" && actions.onOpenRow!(row.original, result.columns)
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = result.columns.find((c) => c.key === cell.column.id);
                  const numeric =
                    meta && ["number", "currency", "percent", "sqft"].includes(meta.type);
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "max-w-md px-3 py-2 align-top text-[var(--acton-navy)]",
                        numeric && "text-right tabular-nums",
                        meta?.wrap ? "whitespace-pre-wrap" : "truncate",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-[var(--acton-muted)] print:hidden">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      ) : null}
      <Dialog open={comparing} onClose={() => setComparing(false)} size="lg">
        <DialogHeader>
          <DialogTitle>Compare side by side</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <ComparisonTable
            columns={result.columns}
            rows={result.rows.filter((r) => selected.includes(r.id))}
          />
        </DialogBody>
      </Dialog>
    </div>
  );
}

/** Attributes as rows, selected records as columns; differing values are highlighted. */
export function ComparisonTable({ columns, rows }: { columns: FieldMeta[]; rows: TableRowData[] }) {
  const [first, ...rest] = columns;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2 text-xs text-[var(--acton-muted)]">{first?.label}</th>
            {rows.map((r) => (
              <th key={r.id} className="px-3 py-2 font-semibold text-[var(--acton-navy)]">
                {formatValue(first ? r.cells[first.key] : r.id, first?.type ?? "text")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rest.map((c) => {
            const values = rows.map((r) => formatValue(r.cells[c.key], c.type));
            const differs = new Set(values).size > 1;
            return (
              <tr key={c.key} className="border-t border-[var(--acton-gray-100)]">
                <th
                  scope="row"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--acton-muted)]"
                >
                  {c.label}
                </th>
                {values.map((v, i) => (
                  <td
                    key={i}
                    className={cn(
                      "px-3 py-2 text-[var(--acton-navy)] tabular-nums",
                      differs && "bg-amber-50 font-semibold",
                    )}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[var(--acton-muted)]">
        Highlighted rows differ between the selected records.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project widgets
// ---------------------------------------------------------------------------

function MissingValue({ restricted }: { restricted?: boolean }) {
  return restricted ? (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--acton-muted)]">
      <Lock className="h-3 w-3" aria-hidden /> Restricted
    </span>
  ) : (
    <span className="text-[var(--acton-muted)]">—</span>
  );
}

function DetailWidget({ spec, result }: { spec: WidgetSpec; result: DetailResult }) {
  const detailSpec = spec.type === "detail" ? spec : null;
  const style = detailSpec?.style ?? "grid";
  const formatOf = (key: string) => detailSpec?.fields.find((f) => f.field === key)?.format;
  if (!result.jobId)
    return (
      <StatusMessage result={{ ...result, status: "empty", message: "Choose a project above." }} />
    );
  if (style === "long_text") {
    return (
      <dl className="space-y-4">
        {result.items.map((item) => (
          <div key={item.key}>
            <dt className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              {item.label}
              {item.missing ? (
                <span className="ml-2 font-normal normal-case">(not available)</span>
              ) : null}
            </dt>
            <dd className="mt-1 text-sm whitespace-pre-wrap text-[var(--acton-navy)]">
              {item.restricted || item.value === null || item.value === "" ? (
                <MissingValue restricted={item.restricted} />
              ) : (
                formatValue(item.value, resolveDisplayType(formatOf(item.key), item.type))
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  if (style === "badges") {
    return (
      <div className="flex flex-wrap gap-2">
        {result.items.map((item) => (
          <span
            key={item.key}
            className="rounded-full bg-[var(--acton-gray-50)] px-3 py-1 text-xs text-[var(--acton-navy)]"
          >
            <span className="text-[var(--acton-muted)]">{item.label}:</span>{" "}
            {item.restricted
              ? "Restricted"
              : formatValue(item.value, resolveDisplayType(formatOf(item.key), item.type))}
          </span>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {result.items.map((item) => (
        <div key={item.key} className="min-w-0">
          <dt
            className="text-xs text-[var(--acton-muted)]"
            title={item.missing ? "This field isn't mapped to JobTread yet" : undefined}
          >
            {item.label}
          </dt>
          <dd className="text-sm font-medium break-words text-[var(--acton-navy)]">
            {item.restricted ||
            item.missing ||
            item.value === null ||
            item.value === "" ||
            (Array.isArray(item.value) && !item.value.length) ? (
              <MissingValue restricted={item.restricted} />
            ) : (
              formatValue(item.value, resolveDisplayType(formatOf(item.key), item.type))
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HeaderWidget({ result }: { result: HeaderResult }) {
  if (!result.jobId)
    return (
      <StatusMessage result={{ ...result, status: "empty", message: "Choose a project above." }} />
    );
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          {result.number ? `Job ${result.number}` : "Project"}
        </p>
        <h2 className="text-xl font-bold text-[var(--acton-navy)]">{result.name}</h2>
        <p className="text-sm text-[var(--acton-muted)]">
          {[result.customer, result.address].filter(Boolean).join(" · ") || "—"}
        </p>
        {result.badges.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {result.badges.map((b) => (
              <span
                key={b.label}
                className="rounded-full bg-[var(--acton-gray-50)] px-2.5 py-0.5 text-xs text-[var(--acton-navy)]"
              >
                <span className="text-[var(--acton-muted)]">{b.label}:</span> {b.value || "—"}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {result.jobtreadUrl ? (
        <a
          href={result.jobtreadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--acton-navy)] hover:underline print:hidden"
        >
          Open in JobTread <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

const MS_DAY = 86_400_000;

function MilestonesWidget({ spec, result }: { spec: WidgetSpec; result: MilestonesResult }) {
  const [today] = useState(() => Date.now());
  const style = spec.type === "milestones" ? spec.style : "list";
  const dated = result.milestones.filter((m) => m.startDate || m.endDate);
  const icon = (status: string) =>
    status === "complete" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Complete" />
    ) : status === "in_progress" ? (
      <CircleDot className="h-4 w-4 text-sky-600" aria-label="In progress" />
    ) : (
      <Circle className="h-4 w-4 text-slate-400" aria-label="Not started" />
    );
  const fmt = (d: string | null) => formatValue(d, "date");

  if (style === "timeline" && dated.length) {
    const times = dated
      .flatMap((m) => [m.startDate, m.endDate])
      .filter((d): d is string => Boolean(d))
      .map((d) => new Date(`${d.slice(0, 10)}T12:00:00`).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times, min + MS_DAY);
    const pct = (t: number) => `${(((t - min) / (max - min)) * 100).toFixed(2)}%`;
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-[var(--acton-muted)]">
          <span>{fmt(new Date(min).toISOString())}</span>
          <span>{fmt(new Date(max).toISOString())}</span>
        </div>
        <ul className="space-y-2">
          {result.milestones.map((m) => {
            const s = m.startDate
              ? new Date(`${m.startDate.slice(0, 10)}T12:00:00`).getTime()
              : null;
            const e = m.endDate ? new Date(`${m.endDate.slice(0, 10)}T12:00:00`).getTime() : s;
            const start = s ?? e;
            return (
              <li key={m.id} className="grid grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-3">
                <div className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--acton-navy)]">
                  {icon(m.status)}
                  <span className="truncate" title={m.name}>
                    {m.name}
                  </span>
                </div>
                <div
                  className="relative h-6 rounded bg-[var(--acton-gray-50)]"
                  title={`${m.name}: ${fmt(m.startDate)} – ${fmt(m.endDate)} · ${m.completedTasks}/${m.totalTasks} tasks done`}
                >
                  {start !== null && e !== null ? (
                    <div
                      className={cn(
                        "absolute top-1 bottom-1 min-w-1.5 rounded",
                        m.status === "complete"
                          ? "bg-emerald-500"
                          : m.status === "in_progress"
                            ? "bg-sky-500"
                            : "bg-slate-300",
                      )}
                      style={{
                        left: pct(start),
                        width: `max(6px, calc(${pct(e)} - ${pct(start)}))`,
                      }}
                    />
                  ) : (
                    <span className="absolute inset-0 flex items-center px-2 text-xs text-[var(--acton-muted)]">
                      No dates
                    </span>
                  )}
                  {today >= min && today <= max ? (
                    <div
                      className="absolute top-0 bottom-0 w-px bg-red-500"
                      style={{ left: pct(today) }}
                      aria-hidden
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-[var(--acton-muted)]">
          Red line marks today. Hover a bar for dates and task progress.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-[var(--acton-gray-100)]">
      {result.milestones.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-[var(--acton-navy)]">
            {icon(m.status)}
            <span className="truncate">{m.name}</span>
          </span>
          <span className="shrink-0 text-xs text-[var(--acton-muted)] tabular-nums">
            {m.totalTasks ? `${m.completedTasks}/${m.totalTasks} done` : ""}
            {m.startDate || m.endDate ? ` · ${fmt(m.startDate)} – ${fmt(m.endDate)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DocumentsWidget({ spec, result }: { spec: WidgetSpec; result: DocumentsResult }) {
  const byFolder = spec.type === "documents" ? spec.groupByFolder : true;
  const groups = new Map<string, DocumentsResult["files"]>();
  for (const f of result.files) {
    const k = byFolder ? f.folder || "Unfiled" : "All files";
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([folder, files]) => (
        <div key={folder}>
          {byFolder ? (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--acton-muted)]">
              <Folder className="h-3.5 w-3.5" aria-hidden /> {folder} ({files.length})
            </p>
          ) : null}
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--acton-muted)]" aria-hidden />
                <span className="truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-[var(--acton-muted)]">
                  {formatValue(f.createdAt, "date")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {result.jobtreadUrl ? (
        <a
          href={result.jobtreadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acton-navy)] hover:underline print:hidden"
        >
          Open files in JobTread <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
