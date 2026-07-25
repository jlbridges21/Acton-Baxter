import { parseCellValue } from "./values";
import { salesPerformanceReportFixture } from "./fixtures/sales-performance-report";

/**
 * Expected sold agreement totals from the Sales Report fixture (excludes Raw Data).
 * Used by unit tests and eval seed expectations.
 */
export function expectedSoldAgreementForYear(year: number): { sum: number; count: number } {
  const fixture = salesPerformanceReportFixture();
  const sales = fixture.sheets.find((s) => s.name === "Sales Report")!;
  const headerIdx = sales.grid.findIndex((r) => r[0] === "Customer Name");
  let sum = 0;
  let count = 0;
  for (let i = headerIdx + 1; i < sales.grid.length; i++) {
    const row = sales.grid[i]!;
    const close = parseCellValue(String(row[2] ?? ""));
    if (!close.dateIso?.startsWith(String(year))) continue;
    const amount = parseCellValue(String(row[4] ?? ""));
    if (amount.numeric == null) continue;
    sum += amount.numeric;
    count += 1;
  }
  return { sum, count };
}
