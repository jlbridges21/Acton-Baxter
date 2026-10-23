/**
 * Job financials derived from JobTread documents (pure, deterministic).
 *
 * JobTread has no gross-profit field. What it does have (verified 2026-10-22):
 *   - customer orders (estimates/contracts) with total price and cost — 1 approved, 372 drafts
 *   - customer invoices with price, amount paid, and balance — 10 drafts, $0 paid
 *   - no payment records (organization.payments count = 0)
 *
 * So gross profit here is always *projected* (order price − order cost), and its basis is
 * reported with every number.
 */

export type DocumentRow = {
  id: string;
  job_id: string | null;
  type: string;
  status: string | null;
  issue_date: string | null;
  source_created_at?: string | null;
  price: number | string | null;
  cost: number | string | null;
  amount_paid: number | string | null;
  balance: number | string | null;
};

export type JobFinancials = {
  orderPrice: number | null;
  orderCost: number | null;
  orderGrossProfit: number | null;
  orderMarginPct: number | null;
  orderStatus: string | null;
  orderDate: string | null;
  orderCount: number;
  invoicedTotal: number | null;
  amountPaid: number | null;
  balanceDue: number | null;
  lastInvoiceDate: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

const dateOf = (d: DocumentRow) => d.issue_date ?? d.source_created_at?.slice(0, 10) ?? "";

/** Approved order wins; otherwise the most recent order (by issue date, then creation). */
export function primaryCustomerOrder(docs: DocumentRow[]): DocumentRow | null {
  const orders = docs.filter((d) => d.type === "customerOrder" && d.status !== "denied");
  if (!orders.length) return null;
  const approved = orders.filter((d) => d.status === "approved");
  const pool = approved.length ? approved : orders;
  return [...pool].sort(
    (a, b) => dateOf(b).localeCompare(dateOf(a)) || b.id.localeCompare(a.id),
  )[0]!;
}

export function jobFinancials(docs: DocumentRow[]): JobFinancials {
  const order = primaryCustomerOrder(docs);
  const price = order ? num(order.price) : null;
  const cost = order ? num(order.cost) : null;
  const invoices = docs.filter((d) => d.type === "customerInvoice");
  const sum = (vals: Array<number | null>) =>
    vals.some((v) => v !== null) ? round2(vals.reduce<number>((s, v) => s + (v ?? 0), 0)) : null;
  return {
    orderPrice: price,
    orderCost: cost,
    orderGrossProfit: price !== null && cost !== null ? round2(price - cost) : null,
    orderMarginPct:
      price && cost !== null ? Math.round(((price - cost) / price) * 1000) / 10 : null,
    orderStatus: order?.status ?? null,
    orderDate: order ? dateOf(order) || null : null,
    orderCount: docs.filter((d) => d.type === "customerOrder").length,
    invoicedTotal: invoices.length ? sum(invoices.map((d) => num(d.price))) : null,
    amountPaid: invoices.length ? sum(invoices.map((d) => num(d.amount_paid))) : null,
    balanceDue: invoices.length ? sum(invoices.map((d) => num(d.balance))) : null,
    lastInvoiceDate: invoices.map(dateOf).filter(Boolean).sort().at(-1) ?? null,
  };
}

export function groupDocumentsByJob(docs: DocumentRow[]): Map<string, DocumentRow[]> {
  const map = new Map<string, DocumentRow[]>();
  for (const d of docs) {
    if (!d.job_id) continue;
    map.set(d.job_id, [...(map.get(d.job_id) ?? []), d]);
  }
  return map;
}
