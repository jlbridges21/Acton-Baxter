"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Edit a list of short phrases (examples, keywords, tasks) without JSON. */
export function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  readOnly,
  maxItems = 40,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  readOnly?: boolean;
  maxItems?: number;
}) {
  const [value, setValue] = useState("");
  function add() {
    const v = value.trim();
    if (!v || items.includes(v) || items.length >= maxItems) return;
    onChange([...items, v]);
    setValue("");
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5" aria-label={label}>
        {items.length === 0 ? (
          <li className="text-sm text-[var(--acton-muted)] italic">None yet.</li>
        ) : null}
        {items.map((item, i) => (
          <li
            key={`${item}-${i}`}
            className="flex items-center justify-between gap-2 rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-1.5 text-sm text-[var(--acton-navy)]"
          >
            <span className="min-w-0 break-words">{item}</span>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove "${item}"`}
                className="shrink-0 rounded p-1 text-[var(--acton-muted)] hover:bg-white hover:text-red-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!readOnly ? (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            aria-label={`Add to ${label}`}
            className="h-9"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={add}
            disabled={!value.trim() || items.length >= maxItems}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
