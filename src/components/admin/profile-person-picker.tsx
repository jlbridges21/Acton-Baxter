"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type PersonOption = {
  id: string;
  displayName: string;
  email?: string | null;
};

type ProfilePersonPickerProps = {
  people: PersonOption[];
  value: string | null;
  onChange: (profileId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  /** Shown when a person is selected (name only — never a UUID). */
  clearLabel?: string;
};

/**
 * Searchable person picker (name + email). Pattern mirrors address autocomplete:
 * filter locally, listbox for keyboard/mouse selection. Never displays UUIDs.
 */
export function ProfilePersonPicker({
  people,
  value,
  onChange,
  disabled = false,
  placeholder = "Search by name or email…",
  id,
  clearLabel = "Clear",
}: ProfilePersonPickerProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const inputId = id ?? `${generatedId}-input`;
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = people.find((p) => p.id === value) ?? null;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people.slice(0, 40);
    return people
      .filter((p) => {
        const hay = `${p.displayName} ${p.email ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 40);
  }, [people, query]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function selectPerson(person: PersonOption) {
    onChange(person.id);
    setQuery("");
    setOpen(false);
    setHighlightedIndex(-1);
  }

  return (
    <div ref={containerRef} className="relative min-w-[16rem] flex-1">
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--acton-navy)]">
              {selected.displayName}
            </p>
            {selected.email ? (
              <p className="truncate text-xs text-[var(--acton-muted)]">{selected.email}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="text-xs font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline disabled:opacity-50"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            {clearLabel}
          </button>
        </div>
      ) : (
        <>
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            disabled={disabled}
            placeholder={placeholder}
            value={query}
            className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlightedIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
                setOpen(true);
                return;
              }
              if (e.key === "Escape") {
                setOpen(false);
                setHighlightedIndex(-1);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightedIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && highlightedIndex >= 0 && filtered[highlightedIndex]) {
                e.preventDefault();
                selectPerson(filtered[highlightedIndex]!);
              }
            }}
          />
          {open ? (
            <ul
              id={listboxId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-[var(--acton-border)] bg-white shadow-md"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-[var(--acton-muted)]">No matches</li>
              ) : (
                filtered.map((person, index) => (
                  <li
                    key={person.id}
                    role="option"
                    aria-selected={index === highlightedIndex}
                    className={cn(
                      "cursor-pointer px-3 py-2 text-sm",
                      index === highlightedIndex
                        ? "bg-[var(--acton-gray-50)] text-[var(--acton-navy)]"
                        : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectPerson(person);
                    }}
                  >
                    <span className="font-medium">{person.displayName}</span>
                    {person.email ? (
                      <span className="mt-0.5 block text-xs text-[var(--acton-muted)]">
                        {person.email}
                      </span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
