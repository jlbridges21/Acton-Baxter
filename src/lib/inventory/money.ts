/**
 * Inventory money — integer cents. Zero is allowed (price not known yet).
 * Negatives and more than two decimal places are rejected.
 */

import { ValidationError } from "@/lib/errors";

export function parseInventoryUnitCostToCents(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) {
    throw new ValidationError("Unit cost is required");
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      throw new ValidationError("Unit cost cannot be negative");
    }
    const cents = Math.round(raw * 100);
    if (cents < 0) throw new ValidationError("Unit cost cannot be negative");
    return cents;
  }

  const trimmed = String(raw).trim();
  if (!trimmed) throw new ValidationError("Unit cost is required");

  const cleaned = trimmed.replace(/\$/g, "").replace(/,/g, "").replace(/\s+/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new ValidationError("Enter a valid unit cost (e.g. 42.50)");
  }
  const [dollarsPart, fractionPart = ""] = cleaned.split(".");
  const dollars = Number.parseInt(dollarsPart || "0", 10);
  const centsPart = Number.parseInt((fractionPart + "00").slice(0, 2), 10);
  return dollars * 100 + centsPart;
}

export function inventoryTotalCents(quantity: number, unitCostCents: number): number {
  return quantity * unitCostCents;
}
