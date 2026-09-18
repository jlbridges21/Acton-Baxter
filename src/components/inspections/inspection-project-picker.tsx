"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import type { ExpenseJob } from "@/lib/receipts/types";
import { normalizeCustomJobLabel, shouldOfferCreateCustomJob } from "@/lib/receipts/job-select";
import { splitProjectLabel } from "@/lib/inspections/project-label";

export type ProjectPick =
  | { kind: "job"; job: ExpenseJob; projectName: string; address: string }
  | { kind: "custom"; projectName: string; address: string };

export function InspectionProjectPicker({
  jobs,
  onPick,
  disabled,
}: {
  jobs: ExpenseJob[];
  onPick: (pick: ProjectPick) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) => j.label.toLowerCase().includes(q) || (j.projectNumber ?? "").toLowerCase().includes(q),
    );
  }, [jobs, query]);

  const canCreate = shouldOfferCreateCustomJob(
    query,
    jobs.map((j) => j.label),
  );
  const optionCount = filtered.length + (canCreate ? 1 : 0);
  const createIndex = canCreate ? filtered.length : -1;

  function selectJob(job: ExpenseJob) {
    const { projectName, address } = splitProjectLabel(job.label);
    onPick({
      kind: "job",
      job,
      projectName: projectName || job.label,
      address,
    });
    setQuery(job.label);
    setOpen(false);
    setHighlight(-1);
  }

  function selectCreate() {
    const label = normalizeCustomJobLabel(query);
    if (!label || !canCreate) return;
    onPick({ kind: "custom", projectName: label, address: "" });
    setQuery(label);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open || optionCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i < 0 ? 0 : Math.min(i + 1, optionCount - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? -1 : i - 1));
      return;
    }
    if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      if (canCreate && highlight === createIndex) selectCreate();
      else {
        const job = filtered[highlight];
        if (job) selectJob(job);
      }
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={listId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-option-${highlight}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder="Search projects or type a name"
        className="min-h-12 text-base"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            setHighlight(-1);
          }, 150);
        }}
      />
      {open ? (
        <div className="absolute z-20 mt-1 flex max-h-56 w-full flex-col overflow-hidden rounded-md border border-[var(--acton-border)] bg-white shadow-md">
          <ul id={`${listId}-list`} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
            {filtered.map((job, index) => (
              <li
                key={job.id}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={highlight === index}
              >
                <button
                  type="button"
                  className={`min-h-11 w-full px-3 py-2 text-left text-sm text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] ${
                    highlight === index ? "bg-[var(--acton-gray-50)]" : ""
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => selectJob(job)}
                >
                  {job.label}
                </button>
              </li>
            ))}
          </ul>
          {canCreate ? (
            <div
              id={`${listId}-option-${createIndex}`}
              role="option"
              aria-selected={highlight === createIndex}
              className="shrink-0 border-t border-[var(--acton-border)] bg-[var(--acton-gray-50)]"
            >
              <button
                type="button"
                className={`min-h-11 w-full px-3 py-2 text-left text-sm font-medium text-[var(--acton-navy)] hover:bg-white ${
                  highlight === createIndex ? "bg-white" : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(createIndex)}
                onClick={() => selectCreate()}
              >
                + Create &ldquo;{normalizeCustomJobLabel(query)}&rdquo;
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
