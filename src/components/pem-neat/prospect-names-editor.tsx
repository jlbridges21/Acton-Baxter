"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatProspectDisplayName } from "@/lib/pem-neat/prospect-names";

/**
 * Repeatable prospect-name editor (same add/remove pattern as project-setup email lists).
 * First name is required; additional homeowners are optional.
 */
export function ProspectNamesEditor({
  names,
  onChange,
  disabled,
}: {
  names: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const rows = names.length > 0 ? names : [""];
  const preview = formatProspectDisplayName(rows.filter((n) => n.trim()));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-[var(--acton-navy)]">
          Prospect name(s)
        </label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange([...rows, ""])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add prospect
        </Button>
      </div>
      <p className="mb-2 text-xs text-[var(--acton-muted)]">
        Add each homeowner as a separate name so Baxter can find this NEAT by any of them. The
        display label is derived automatically
        {preview ? ` (“${preview}”)` : ""}.
      </p>
      <div className="space-y-2">
        {rows.map((name, index) => (
          <div key={`prospect-${index}`} className="flex gap-2">
            <input
              value={name}
              onChange={(e) => {
                const next = [...rows];
                next[index] = e.target.value;
                onChange(next);
              }}
              placeholder={index === 0 ? "First homeowner (required)" : "Additional homeowner"}
              disabled={disabled}
              required={index === 0}
              aria-label={index === 0 ? "Primary prospect name" : `Prospect name ${index + 1}`}
              className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)]"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || rows.length <= 1}
              aria-label="Remove prospect"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
