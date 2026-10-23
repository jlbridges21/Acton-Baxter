"use client";

/** Report-level filters. Options and counts come from the server's authorized execution. */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ControlOptions, ControlState } from "@/lib/reports/result-types";
import type { ControlSpec } from "@/lib/reports/spec";

const inputClass =
  "h-9 rounded-md border border-[var(--acton-border)] bg-white px-2.5 text-sm text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none";

export function FilterBar({
  controls,
  options,
  state,
  onChange,
}: {
  controls: ControlSpec[];
  options: Record<string, ControlOptions>;
  state: ControlState;
  onChange: (next: ControlState) => void;
}) {
  if (!controls.length) return null;
  const set = (id: string, value: ControlState[string]) => onChange({ ...state, [id]: value });
  const active = Object.entries(state).some(([k, v]) => {
    const c = controls.find((x) => x.id === k);
    if (!c || c.kind === "job_picker") return false;
    return Array.isArray(v) ? v.some((x) => x !== null && x !== "") : Boolean(v);
  });
  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--acton-border)] bg-white p-3 print:border-0 print:p-0"
      role="group"
      aria-label="Report filters"
    >
      {controls.map((c) => {
        const o = options[c.id];
        const id = `ctl-${c.id}`;
        return (
          <div key={c.id} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={id} className="text-xs font-semibold text-[var(--acton-muted)]">
              {c.label}
            </label>
            {c.kind === "job_picker" ? (
              <select
                id={id}
                className={cn(inputClass, "max-w-xs min-w-56")}
                value={(o?.kind === "job_picker" ? o.selected : null) ?? ""}
                onChange={(e) => set(c.id, e.target.value || null)}
              >
                {o?.kind === "job_picker" && o.options.length ? null : (
                  <option value="">No projects</option>
                )}
                {o?.kind === "job_picker"
                  ? o.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  : null}
              </select>
            ) : c.kind === "select" ? (
              <MultiSelect
                id={id}
                label={c.label}
                options={o?.kind === "select" ? o.options : []}
                restricted={o?.kind === "select" && o.restricted}
                multiple={c.multiple}
                selected={
                  (state[c.id] as string[] | undefined) ?? (o?.kind === "select" ? o.selected : [])
                }
                onChange={(v) => set(c.id, v)}
              />
            ) : c.kind === "search" ? (
              <SearchInput
                id={id}
                value={(state[c.id] as string | undefined) ?? ""}
                onChange={(v) => set(c.id, v || null)}
              />
            ) : c.kind === "number_range" ? (
              <RangeInputs
                id={id}
                kind="number"
                placeholderMin={
                  o?.kind === "number_range" && o.min !== null ? String(o.min) : "Min"
                }
                placeholderMax={
                  o?.kind === "number_range" && o.max !== null ? String(o.max) : "Max"
                }
                value={(state[c.id] as [number | null, number | null] | undefined) ?? [null, null]}
                onChange={(v) => set(c.id, v as ControlState[string])}
              />
            ) : (
              <RangeInputs
                id={id}
                kind="date"
                value={(state[c.id] as [string | null, string | null] | undefined) ?? [null, null]}
                onChange={(v) => set(c.id, v as ControlState[string])}
              />
            )}
          </div>
        );
      })}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange(
              Object.fromEntries(
                Object.entries(state).filter(
                  ([k]) => controls.find((c) => c.id === k)?.kind === "job_picker",
                ),
              ),
            )
          }
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset filters
        </Button>
      ) : null}
    </div>
  );
}

function SearchInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => onChange(text.trim()), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-[var(--acton-muted)]"
        aria-hidden
      />
      <input
        id={id}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search"
        className={cn(inputClass, "w-56 pl-8")}
      />
    </div>
  );
}

function RangeInputs<T extends string | number>({
  id,
  kind,
  value,
  onChange,
  placeholderMin = "From",
  placeholderMax = "To",
}: {
  id: string;
  kind: "number" | "date";
  value: [T | null, T | null];
  onChange: (v: [T | null, T | null]) => void;
  placeholderMin?: string;
  placeholderMax?: string;
}) {
  const parse = (raw: string): T | null =>
    raw === "" ? null : ((kind === "number" ? Number(raw) : raw) as T);
  return (
    <div className="flex items-center gap-1.5">
      <input
        id={id}
        type={kind}
        aria-label="Minimum"
        placeholder={placeholderMin}
        className={cn(inputClass, kind === "number" ? "w-24" : "w-36")}
        value={value[0] ?? ""}
        onChange={(e) => onChange([parse(e.target.value), value[1]])}
      />
      <span className="text-xs text-[var(--acton-muted)]">to</span>
      <input
        type={kind}
        aria-label="Maximum"
        placeholder={placeholderMax}
        className={cn(inputClass, kind === "number" ? "w-24" : "w-36")}
        value={value[1] ?? ""}
        onChange={(e) => onChange([value[0], parse(e.target.value)])}
      />
    </div>
  );
}

function MultiSelect({
  id,
  label,
  options,
  selected,
  multiple,
  restricted,
  onChange,
}: {
  id: string;
  label: string;
  options: Array<{ value: string; count: number }>;
  selected: string[];
  multiple: boolean;
  restricted?: boolean;
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const summary = restricted
    ? "Restricted"
    : selected.length === 0
      ? "All"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;
  const shown = options.filter((o) => o.value.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="relative" ref={ref}>
      <button
        id={id}
        type="button"
        disabled={restricted}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(inputClass, "flex w-48 items-center justify-between gap-2 text-left")}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--acton-muted)]" aria-hidden />
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 w-72 rounded-md border border-[var(--acton-border)] bg-white p-2 shadow-lg">
          {options.length > 8 ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Find ${label.toLowerCase()}`}
              className={cn(inputClass, "mb-2 w-full")}
            />
          ) : null}
          <ul role="listbox" aria-multiselectable={multiple} className="max-h-64 overflow-auto">
            {shown.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]">
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={id}
                      checked={checked}
                      onChange={() =>
                        onChange(
                          multiple
                            ? checked
                              ? selected.filter((v) => v !== o.value)
                              : [...selected, o.value]
                            : checked
                              ? []
                              : [o.value],
                        )
                      }
                    />
                    <span className="flex-1 truncate">{o.value}</span>
                    <span className="text-xs text-[var(--acton-muted)] tabular-nums">
                      {o.count}
                    </span>
                  </label>
                </li>
              );
            })}
            {shown.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-[var(--acton-muted)]">No values</li>
            ) : null}
          </ul>
          {selected.length ? (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-[var(--acton-navy)] hover:underline"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
