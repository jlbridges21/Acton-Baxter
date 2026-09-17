/**
 * CSV export for the admin Receipt Log — decimal dollars + durable photo permalinks.
 */

import { formatCentsAsDecimalDollars } from "./amount";
import type { ReceiptLogRow } from "./log-query";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildReceiptLogCsv(rows: ReceiptLogRow[], origin?: string): string {
  const header = [
    "Submitter",
    "Date logged",
    "Date purchased",
    "Photo",
    "Job",
    "Vendor",
    "Amount",
    "Items",
    "Description",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const photo = row.photoStoragePath
      ? origin
        ? `${origin.replace(/\/$/, "")}${row.photoPermalink}`
        : row.photoPermalink
      : "";
    lines.push(
      [
        csvEscape(row.submitterName),
        csvEscape(row.createdAt.slice(0, 10)),
        csvEscape(row.purchasedOn),
        csvEscape(photo),
        csvEscape(row.jobLabel),
        csvEscape(row.vendor),
        csvEscape(formatCentsAsDecimalDollars(row.amountCents)),
        csvEscape(row.items ?? ""),
        csvEscape(row.description ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
