"use client";

/**
 * Viewer controls: group-by (one or several ordered levels), sort, and metric pickers. Choices
 * only change this viewer's view of the report (and can be saved as a personal view); the
 * published defaults change only when an editor saves a new report version.
 */

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ControlOptions, ControlState } from "@/lib/reports/result-types";

const selectClass =
  "h-9 rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none";

export function GroupByPicker({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: Extract<ControlOptions, { kind: "group_by" }> | undefined;
  value: ControlState[string] | undefined;
  onChange: (v: string[]) => void;
}) {
  const levels = Array.isArray(value)
    ? (value.filter((v) => typeof v === "string") as string[])
    : (options?.selected ?? []);
  const max = options?.maxLevels ?? 1;
  const labelOf = (v: string) => options?.options.find((o) => o.value === v)?.label ?? v;
  const remaining = (options?.options ?? []).filter((o) => !levels.includes(o.value));
  const move = (i: number, d: -1 | 1) => {
    const next = [...levels];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1" id={id}>
      {levels.map((v, i) => (
        <span
          key={v}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-2 text-sm text-[var(--acton-navy)]"
        >
          {i > 0 ? <span className="text-xs text-[var(--acton-muted)]">then</span> : null}
          {labelOf(v)}
          {levels.length > 1 ? (
            <>
              <button
                type="button"
                aria-label={`Move ${labelOf(v)} up`}
                disabled={i === 0}
                className="disabled:opacity-30"
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Move ${labelOf(v)} down`}
                disabled={i === levels.length - 1}
                className="disabled:opacity-30"
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="h-3 w-3" aria-hidden />
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-label={`Remove ${labelOf(v)} grouping`}
            onClick={() => onChange(levels.filter((x) => x !== v))}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {levels.length < max && remaining.length ? (
        <select
          aria-label="Add a grouping level"
          className={cn(selectClass, "w-40")}
          value=""
          onChange={(e) => e.target.value && onChange([...levels, e.target.value])}
        >
          <option value="">{levels.length ? "Then by…" : "Group by…"}</option>
          {remaining.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      {!levels.length && !remaining.length ? (
        <span className="text-xs text-[var(--acton-muted)]">No fields available</span>
      ) : null}
    </div>
  );
}

export function SortPicker({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: Extract<ControlOptions, { kind: "sort" }> | undefined;
  value: ControlState[string] | undefined;
  onChange: (v: string[] | null) => void;
}) {
  const current =
    Array.isArray(value) && typeof value[0] === "string"
      ? { field: value[0], dir: value[1] === "asc" ? "asc" : "desc" }
      : options?.selected
        ? { field: options.selected.field, dir: options.selected.dir }
        : null;
  return (
    <div className="flex items-center gap-1">
      <select
        id={id}
        className={cn(selectClass, "w-44")}
        value={current?.field ?? ""}
        onChange={(e) => onChange(e.target.value ? [e.target.value, current?.dir ?? "desc"] : null)}
      >
        <option value="">Default order</option>
        {(options?.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={cn(selectClass, "inline-flex items-center gap-1 px-2")}
        disabled={!current}
        aria-label={
          current?.dir === "asc"
            ? "Sort ascending (click for descending)"
            : "Sort descending (click for ascending)"
        }
        onClick={() => current && onChange([current.field, current.dir === "asc" ? "desc" : "asc"])}
      >
        {current?.dir === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="text-xs">{current?.dir === "asc" ? "Low → high" : "High → low"}</span>
      </button>
    </div>
  );
}

export function MetricPicker({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: Extract<ControlOptions, { kind: "metric_picker" }> | undefined;
  value: ControlState[string] | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <select
      id={id}
      className={cn(selectClass, "w-48")}
      value={typeof value === "string" ? value : (options?.selected ?? "")}
      onChange={(e) => onChange(e.target.value)}
    >
      {(options?.options ?? []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
