"use client";

/**
 * Nested, expandable table groups (e.g. Phase → Project Manager → Job) with subtotals and a
 * grand total. All numbers come from the server (subtotals are computed from each group's
 * records there); this component only shows them. Expand/collapse choices and hidden
 * columns are this viewer's own (kept in the browser), never the report's defaults.
 */

import { Fragment, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Columns3, Paintbrush } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CellValue } from "@/lib/reports/compute";
import type { FieldMeta, TableGroup, TableResult } from "@/lib/reports/result-types";
import type { WidgetSpec } from "@/lib/reports/spec";
import { formatValue } from "./format";
import { columnLook, ruleRowStyle, tableLook, useReportTheme } from "./report-theme";

export type GroupDrillRequest = {
  widgetId: string;
  /** Group labels from the top level down (the TableGroup id, parsed). */
  path: string[];
  /** Column clicked (stable column id), when a subtotal cell was clicked. */
  columnId?: string;
  title: string;
};

/** Edit mode: a small button in a column header that opens the column editor. */
export function FormatColumnButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`Format column ${label}`}
      title="Format column"
      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded align-middle text-[var(--acton-muted)] hover:bg-[var(--acton-gray-100)] hover:text-[var(--acton-navy)] print:hidden"
    >
      <Paintbrush className="h-3 w-3" aria-hidden />
    </button>
  );
}

const NUMERIC = new Set(["number", "currency", "percent", "sqft"]);
const ROWS_PER_GROUP = 50;

const PREF_EVENT = "baxter:viewer-pref";

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Viewer-local UI preference (expanded groups, hidden columns). Never throws. */
export function useViewerPref<T>(key: string, initial: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(
    (notify) => {
      window.addEventListener(PREF_EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(PREF_EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    () => readPref(key),
    () => null,
  );
  const value = useMemo<T>(() => {
    if (raw === null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
    // `initial` is a default; only the stored value matters for identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const set = useCallback(
    (v: T) => {
      try {
        if (v === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // Ignore quota/private-mode errors.
      }
      window.dispatchEvent(new Event(PREF_EVENT));
    },
    [key],
  );
  return [value, set];
}

function collectIds(groups: TableGroup[], maxLevel: number, out: string[] = []): string[] {
  for (const g of groups) {
    if (g.level < maxLevel) out.push(g.id);
    collectIds(g.children, maxLevel, out);
  }
  return out;
}

export function ColumnsMenu({
  columns,
  hidden,
  onChange,
}: {
  columns: FieldMeta[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Columns3 className="h-3.5 w-3.5" aria-hidden /> Columns
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-[var(--acton-border)] bg-white p-2 shadow-lg">
          {columns.map((c) => {
            // Stable column id (older prefs stored the field key; both are honored).
            const id = c.columnId ?? c.key;
            const off = hidden.includes(id) || hidden.includes(c.key);
            return (
              <label key={id} className="flex items-center gap-2 px-1 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? hidden.filter((k) => k !== id && k !== c.key)
                        : [...hidden, id],
                    )
                  }
                />
                {c.label}
              </label>
            );
          })}
          {hidden.length ? (
            <button
              type="button"
              className="mt-1 px-1 text-xs font-semibold text-[var(--acton-navy)] underline"
              onClick={() => onChange([])}
            >
              Show all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function GroupedTable({
  widget,
  result,
  onOpenRow,
  onFormatColumn,
  onDrillGroup,
}: {
  widget: WidgetSpec;
  result: TableResult;
  onFormatColumn?: (columnId: string) => void;
  /** Open a group's records (drill-down). Absent in edit mode. */
  onDrillGroup?: (req: GroupDrillRequest) => void;
  onOpenRow?: (
    row: { id: string; cells: Record<string, CellValue>; jobtreadUrl?: string },
    columns: FieldMeta[],
  ) => void;
}) {
  const widgetId = widget.id;
  const theme = useReportTheme();
  const look = tableLook(theme, widget);
  const cl = columnLook(theme, widget, result.columns);
  const groups = useMemo(() => result.groups ?? [], [result.groups]);
  const levels = result.groupLevels ?? [];
  const scope =
    typeof window === "undefined" ? "" : window.location.pathname.replace(/[^a-z0-9/-]/gi, "");
  const levelsKey = levels.map((l) => l.key).join(">");
  const defaultOpen = useMemo(
    () => collectIds(groups, result.expandDepth ?? 1),
    [groups, result.expandDepth],
  );
  const [expanded, setExpanded] = useViewerPref<string[] | null>(
    `baxter.report.expand:${scope}:${widgetId}:${levelsKey}`,
    null,
  );
  const [hidden, setHidden] = useViewerPref<string[]>(
    `baxter.report.columns:${scope}:${widgetId}`,
    cl.hiddenByDefault,
  );
  const [shown, setShown] = useState<Record<string, number>>({});
  const open = useMemo(() => new Set(expanded ?? defaultOpen), [expanded, defaultOpen]);
  const rowsById = useMemo(() => new Map(result.rows.map((r) => [r.id, r])), [result.rows]);
  const columns = result.columns.filter(
    (c) => !hidden.includes(cl.id(c)) && !hidden.includes(c.key),
  );
  const show = (value: CellValue | undefined, meta: FieldMeta) =>
    value === undefined ? "" : (cl.text(meta, value) ?? formatValue(value, meta.type));
  const drill = (g: TableGroup, meta?: FieldMeta) =>
    onDrillGroup?.({
      widgetId,
      path: JSON.parse(g.id) as string[],
      columnId: meta?.columnId,
      title: `${g.fieldLabel}: ${g.label}${meta ? ` — ${meta.label}` : ""}`,
    });

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded([...next]);
  };
  const expandTo = (level: number) => setExpanded(collectIds(groups, level));

  const cell = (
    value: CellValue | undefined,
    meta: FieldMeta,
    cells: Record<string, CellValue>,
  ) => (
    <td
      key={cl.id(meta)}
      style={cl.cellStyle(meta, cells)}
      className={cn(
        "max-w-md align-top",
        look.cell,
        look.cellBorder,
        NUMERIC.has(meta.type) && "text-right tabular-nums",
        cl.align(meta) === "center" && "text-center",
        cl.align(meta) === "left" && "text-left",
        cl.align(meta) === "right" && "text-right",
        meta.wrap ? "whitespace-pre-wrap" : "truncate",
      )}
    >
      {show(value, meta)}
    </td>
  );

  const renderGroup = (g: TableGroup): React.ReactNode => {
    const isOpen = open.has(g.id);
    const leaf = g.children.length === 0;
    const limit = shown[g.id] ?? ROWS_PER_GROUP;
    return (
      <Fragment key={g.id}>
        <tr
          className={cn(
            look.row,
            "text-[var(--acton-navy)]",
            look.subtotalBold ? "font-bold" : "font-semibold",
            look.groupHeader === "subtle"
              ? "bg-white"
              : look.groupHeader === "emphasized"
                ? g.level === 0
                  ? "bg-[var(--acton-gray-100)]"
                  : "bg-[var(--acton-gray-50)]"
                : g.level === 0
                  ? "bg-[var(--acton-gray-50)]"
                  : "bg-white",
          )}
        >
          <td
            className={cn("whitespace-nowrap", look.cell)}
            style={{ paddingLeft: `${0.75 + g.level * 1.25}rem` }}
          >
            <button
              type="button"
              className="inline-flex items-center gap-1 text-left hover:underline"
              aria-expanded={isOpen}
              onClick={() => toggle(g.id)}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              <span className="text-xs font-normal text-[var(--acton-muted)]">{g.fieldLabel}:</span>{" "}
              {g.label}
              {onDrillGroup ? null : (
                <span className="ml-1 text-xs font-normal text-[var(--acton-muted)]">
                  ({g.count.toLocaleString()})
                </span>
              )}
            </button>
            {onDrillGroup ? (
              <button
                type="button"
                className="ml-1 text-xs font-normal text-[var(--acton-muted)] underline decoration-dotted hover:text-[var(--acton-navy)]"
                onClick={() => drill(g)}
                aria-label={`Open the ${g.count} records in ${g.label}`}
              >
                ({g.count.toLocaleString()})
              </button>
            ) : null}
          </td>
          {columns.map((c) => {
            const v = g.values[c.key];
            const text = show(v, c);
            return (
              <td
                key={cl.id(c)}
                className={cn(look.cell, NUMERIC.has(c.type) && "text-right tabular-nums")}
                title={
                  g.incomplete?.[c.key]
                    ? `${g.incomplete[c.key]} record(s) have no value and aren't in this subtotal`
                    : undefined
                }
              >
                {onDrillGroup && v !== undefined && v !== null ? (
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2 hover:text-[var(--acton-navy)]"
                    onClick={() => drill(g, c)}
                    aria-label={`Drill into ${c.label} for ${g.label}`}
                  >
                    {text}
                  </button>
                ) : (
                  text
                )}
                {g.incomplete?.[c.key] ? <span className="text-amber-700">*</span> : null}
              </td>
            );
          })}
        </tr>
        {isOpen && !leaf ? g.children.map(renderGroup) : null}
        {isOpen && leaf
          ? g.rowIds.slice(0, limit).map((id, i) => {
              const r = rowsById.get(id);
              if (!r) return null;
              const clickable = Boolean(onOpenRow);
              return (
                <tr
                  key={`${g.id}:${id}:${i}`}
                  style={ruleRowStyle(theme, r.ruleStyle)}
                  className={cn(
                    look.row,
                    !r.ruleStyle?.color && "text-[var(--acton-navy)]",
                    look.zebra && i % 2 === 1 && "bg-[var(--acton-gray-50)]",
                    clickable && "cursor-pointer hover:bg-[var(--acton-gray-50)]",
                  )}
                  onClick={clickable ? () => onOpenRow!(r, result.columns) : undefined}
                >
                  <td aria-hidden />
                  {columns.map((c) => cell(r.cells[c.key], c, r.cells))}
                </tr>
              );
            })
          : null}
        {isOpen && leaf && g.rowIds.length > limit ? (
          <tr className="border-t border-[var(--acton-gray-100)]">
            <td colSpan={columns.length + 1} className="px-3 py-1.5 text-xs">
              <button
                type="button"
                className="font-semibold text-[var(--acton-navy)] underline"
                style={{ marginLeft: `${2 + (g.level + 1) * 1.25}rem` }}
                onClick={() => setShown((s) => ({ ...s, [g.id]: limit + ROWS_PER_GROUP }))}
              >
                Show {Math.min(ROWS_PER_GROUP, g.rowIds.length - limit)} more of{" "}
                {(g.rowIds.length - limit).toLocaleString()}
              </button>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
          <span>Grouped by {levels.map((l) => l.label).join(" → ")}</span>
          {look.show.expandAll ? (
            <Button size="sm" variant="secondary" onClick={() => expandTo(levels.length)}>
              Expand all
            </Button>
          ) : null}
          {look.show.collapseAll ? (
            <Button size="sm" variant="secondary" onClick={() => setExpanded([])}>
              Collapse all
            </Button>
          ) : null}
          {levels.length > 1 && look.show.expandToLevel ? (
            <label className="inline-flex items-center gap-1">
              Expand to
              <select
                className="h-8 rounded-md border border-[var(--acton-border)] bg-white px-1.5 text-xs"
                value=""
                onChange={(e) => e.target.value && expandTo(Number(e.target.value))}
              >
                <option value="">level…</option>
                {levels.map((l, i) => (
                  <option key={l.key} value={i}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {expanded ? (
            <button type="button" className="underline" onClick={() => setExpanded(null)}>
              Reset
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--acton-muted)]">
          {look.show.columns ? (
            <ColumnsMenu columns={result.columns} hidden={hidden} onChange={setHidden} />
          ) : null}
          <span>
            {groups.length.toLocaleString()} groups · {result.totalRows.toLocaleString()} records
            {result.truncated ? " (first 5,000 loaded)" : ""}
          </span>
        </div>
      </div>
      {result.message ? (
        <p className="text-xs text-[var(--acton-muted)]">{result.message}</p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-[var(--acton-border)]">
        <table className="w-full min-w-max text-sm">
          <thead className={look.head} style={look.headStyle}>
            <tr>
              <th scope="col" className={cn("font-semibold whitespace-nowrap", look.cell)}>
                {levels.map((l) => l.label).join(" › ")}
              </th>
              {columns.map((c) => (
                <th
                  key={cl.id(c)}
                  scope="col"
                  style={cl.headerStyle(c)}
                  className={cn(
                    "font-semibold whitespace-nowrap",
                    look.cell,
                    (cl.headerAlign(c) ?? (NUMERIC.has(c.type) ? "right" : undefined)) ===
                      "right" && "text-right",
                    cl.headerAlign(c) === "center" && "text-center",
                  )}
                  title={c.description ?? c.origin}
                >
                  {c.label}
                  {result.sortedBy?.key === c.key
                    ? result.sortedBy.dir === "asc"
                      ? " ↑"
                      : " ↓"
                    : ""}
                  {onFormatColumn && c.columnId ? (
                    <FormatColumnButton
                      label={c.label}
                      onClick={() => onFormatColumn(c.columnId!)}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(renderGroup)}
            {result.totals ? (
              <tr className="border-t-2 border-[var(--acton-border)] bg-[var(--acton-gray-50)] font-bold text-[var(--acton-navy)]">
                <td className="px-3 py-2 whitespace-nowrap">
                  Grand total ({result.totalRows.toLocaleString()})
                </td>
                {columns.map((c) => (
                  <td
                    key={cl.id(c)}
                    className={cn("px-3 py-2", NUMERIC.has(c.type) && "text-right tabular-nums")}
                  >
                    {show(result.totals![c.key], c)}
                    {result.totalsIncomplete?.[c.key] ? (
                      <span className="text-amber-700">*</span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {Object.keys(result.totalsIncomplete ?? {}).length ? (
        <p className="text-xs text-[var(--acton-muted)]">
          <span className="text-amber-700">*</span> Some records have no value for this column and
          aren&apos;t included in that total.
        </p>
      ) : null}
    </div>
  );
}
