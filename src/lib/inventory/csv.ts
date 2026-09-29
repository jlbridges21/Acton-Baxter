import { formatCentsAsDecimalDollars } from "@/lib/receipts/amount";
import type { InventoryItem } from "./types";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const HEADER = [
  "Vendor",
  "Order #",
  "Project",
  "Category",
  "Item",
  "Description",
  "SKU",
  "Qty",
  "Unit Cost",
  "Total Cost",
  "Status",
  "Delivery Date",
  "Out of Storage",
  "Out Date",
  "Notes",
  "Photo",
  "Link",
];

export function buildInventoryCsv(rows: InventoryItem[]): string {
  const lines = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.vendor ?? ""),
        csvEscape(row.orderNumber ?? ""),
        csvEscape(row.projectLabel),
        csvEscape(row.category ?? ""),
        csvEscape(row.itemName),
        csvEscape(row.description ?? ""),
        csvEscape(row.sku),
        String(row.quantity),
        csvEscape(formatCentsAsDecimalDollars(row.unitCostCents)),
        csvEscape(formatCentsAsDecimalDollars(row.totalCostCents)),
        csvEscape(row.statusLabel),
        csvEscape(row.deliveryDate ?? ""),
        csvEscape(row.storageLabel ?? ""),
        csvEscape(row.outDate ?? ""),
        csvEscape(row.notes ?? ""),
        csvEscape(row.photoUrl ?? ""),
        csvEscape(row.productUrl ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
