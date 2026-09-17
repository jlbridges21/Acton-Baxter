import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ReceiptLogAdminClient } from "@/components/receipts/receipt-log-admin-client";
import { ReceiptLogFiltersPanel } from "@/components/receipts/receipt-log-filters-panel";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { formatCentsAsUsd } from "@/lib/receipts/amount";
import { getReceiptLogDashboard } from "@/lib/receipts/log-dashboard";
import {
  RECEIPT_LOG_EXPORT_PATH,
  buildReceiptLogHref,
  parseFeedbackRangePreset,
  parseReceiptLogDateField,
  parseReceiptLogEntryType,
  parseReceiptLogSortDir,
  parseReceiptLogSortField,
  type ReceiptLogFiltersState,
} from "@/lib/receipts/log-filter-url";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function paramString(raw: string | string[] | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

function paramStringList(raw: string | string[] | undefined): string[] {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export default async function ReceiptsLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/receipts");

  const params = await searchParams;
  const filters: ReceiptLogFiltersState = {
    range: parseFeedbackRangePreset(paramString(params.range)),
    dateField: parseReceiptLogDateField(paramString(params.dateField)),
    customStart: paramString(params.start) ?? "",
    customEnd: paramString(params.end) ?? "",
    userIds: paramStringList(params.user),
    jobIds: paramStringList(params.job),
    vendors: paramStringList(params.vendor),
    amountMin: paramString(params.amountMin) ?? "",
    amountMax: paramString(params.amountMax) ?? "",
    entryType: parseReceiptLogEntryType(paramString(params.entryType)),
    q: paramString(params.q) ?? "",
    sort: parseReceiptLogSortField(paramString(params.sort)),
    dir: parseReceiptLogSortDir(paramString(params.dir)),
  };

  const offsetRaw = Number(paramString(params.offset) ?? "0");
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const dashboard = await getReceiptLogDashboard({
    filters,
    limit: PAGE_SIZE,
    offset,
  });

  const hasMore = offset + dashboard.rows.length < dashboard.totalMatching;
  const nextOffset = offset + PAGE_SIZE;
  const exportHref = buildReceiptLogHref(filters, RECEIPT_LOG_EXPORT_PATH);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/receipts" className="text-sm text-[var(--acton-muted)] hover:underline">
              ← Log Expense
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">Receipt Log</h1>
            <p className="mt-1 text-sm text-[var(--acton-muted)]">
              Filterable list of all submitted expenses. Inside the Receipts PWA scope.
            </p>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardTitle>Receipts</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {dashboard.totalMatching}
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Total amount</CardTitle>
            <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
              {formatCentsAsUsd(dashboard.totalAmountCents)}
            </CardDescription>
          </Card>
        </div>

        <ReceiptLogFiltersPanel
          initial={filters}
          userOptions={dashboard.facets.users}
          jobOptions={dashboard.facets.jobs}
          vendorOptions={dashboard.facets.vendors}
        />

        <ReceiptLogAdminClient
          rows={dashboard.rows}
          filters={filters}
          totalMatching={dashboard.totalMatching}
          totalAmountCents={dashboard.totalAmountCents}
          hasMore={hasMore}
          nextOffset={nextOffset}
          exportHref={exportHref}
        />
      </div>
    </AppShell>
  );
}
