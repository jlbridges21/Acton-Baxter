/**
 * Ground truth for the three real receipt photos that exposed OCR failures.
 *
 * Photo binaries were not present in the repo when this fixture was authored;
 * regression tests use mocked vision responses keyed by these ids. If photos
 * are added under tests/fixtures/receipts/images/, live vision checks can use them.
 */

export type ReceiptFixtureGroundTruth = {
  id: string;
  label: string;
  /** Expected extraction after fixes. */
  amountCents: number;
  purchasedOn: string;
  vendor: string;
  /** Known wrong values the old pipeline produced (for documentation / negative tests). */
  previouslyExtracted: {
    amountCents: number;
    purchasedOn: string;
  };
  /** Line items in cents when applicable (Trader Joe's arithmetic check). */
  lineItemAmountsCents?: number[];
  /** Cross-check totals when the same amount appears twice (dental). */
  crossCheckAmountsCents?: number[];
  notes: string;
};

export const RECEIPT_FIXTURE_GROUND_TRUTH: ReceiptFixtureGroundTruth[] = [
  {
    id: "trader-joes",
    label: "Trader Joe's grocery",
    amountCents: 2096,
    purchasedOn: "2026-07-05",
    vendor: "Trader Joe's",
    previouslyExtracted: { amountCents: 2695, purchasedOn: "2022-07-05" },
    lineItemAmountsCents: [1098, 499, 499],
    notes: "TOTAL PURCHASE $20.96; date 07-05-2026; digit + year failures",
  },
  {
    id: "costco-gas",
    label: "Costco gas",
    amountCents: 6310,
    purchasedOn: "2025-09-11",
    vendor: "Costco",
    previouslyExtracted: { amountCents: 318, purchasedOn: "2023-09-11" },
    notes: "Total Sale $63.10 (15.899 gal @ $3.969/gal); date 09/11/25; per-unit + year failures",
  },
  {
    id: "dental-statement",
    label: "Dental statement",
    amountCents: 150700,
    purchasedOn: "2026-07-24",
    vendor: "Dental",
    previouslyExtracted: { amountCents: 160700, purchasedOn: "2023-09-22" },
    crossCheckAmountsCents: [150700, 150700],
    notes: "PLEASE PAY THIS AMOUNT 1507.00; billing date 07/24/2026; digit + date failures",
  },
];

export function getReceiptFixtureGroundTruth(id: string): ReceiptFixtureGroundTruth {
  const row = RECEIPT_FIXTURE_GROUND_TRUTH.find((f) => f.id === id);
  if (!row) throw new Error(`Unknown receipt fixture: ${id}`);
  return row;
}
