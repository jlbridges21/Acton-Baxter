/** Display formatting for report values (client side). Never changes the numbers. */

import type { CellValue } from "@/lib/reports/compute";
import type { FieldType } from "@/lib/reports/fields";
import type { FieldFormat } from "@/lib/reports/spec";

export type DisplayType = FieldType | FieldFormat | "count";

export function resolveDisplayType(
  format: FieldFormat | undefined,
  fallback: DisplayType,
): DisplayType {
  return !format || format === "auto" ? fallback : format;
}

export function formatValue(value: CellValue | undefined, type: DisplayType): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    switch (type) {
      case "currency":
        return value.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
        });
      case "percent":
        return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
      case "sqft":
        return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} sq ft`;
      case "count":
        return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
      default:
        return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(`${value.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime()))
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return value;
}

/** Compact axis labels ($1.2M, 12k). */
export function formatAxis(value: number, type: DisplayType): string {
  const abs = Math.abs(value);
  const short =
    abs >= 1e6
      ? `${(value / 1e6).toFixed(1)}M`
      : abs >= 1e4
        ? `${Math.round(value / 1e3)}k`
        : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (type === "currency") return `$${short}`;
  if (type === "percent") return `${short}%`;
  return short;
}

export function compareCells(a: CellValue | undefined, b: CellValue | undefined): number {
  const blankA = a === null || a === undefined || a === "" || (Array.isArray(a) && !a.length);
  const blankB = b === null || b === undefined || b === "" || (Array.isArray(b) && !b.length);
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(Array.isArray(a) ? a.join(", ") : a).localeCompare(
    String(Array.isArray(b) ? b.join(", ") : b),
    undefined,
    { numeric: true },
  );
}
