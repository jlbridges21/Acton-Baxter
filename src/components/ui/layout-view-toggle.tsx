"use client";

import { LayoutGrid, List } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LayoutView = "grid" | "list";

export function LayoutViewToggle({
  view,
  onChange,
  label,
}: {
  view: LayoutView;
  onChange: (view: LayoutView) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-md border border-[var(--acton-border)] bg-white p-0.5 shadow-sm"
    >
      <ViewButton
        label="Grid view"
        active={view === "grid"}
        onClick={() => onChange("grid")}
        icon={<LayoutGrid className="h-4 w-4" />}
      />
      <ViewButton
        label="List view"
        active={view === "list"}
        onClick={() => onChange("list")}
        icon={<List className="h-4 w-4" />}
      />
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
        active
          ? "bg-[var(--acton-navy)] text-white"
          : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
      )}
    >
      {icon}
    </button>
  );
}
