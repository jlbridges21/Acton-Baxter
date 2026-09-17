import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ReceiptLogFiltersPanel } from "@/components/receipts/receipt-log-filters-panel";
import { ReceiptLogListClient } from "@/components/receipts/receipt-log-list-client";
import { requireActiveUser } from "@/lib/auth/session";
import { formatCentsAsUsd } from "@/lib/receipts/amount";
import { getMyReceiptLogDashboard } from "@/lib/receipts/log-dashboard";
import {
  MY_RECEIPTS_EXPORT_PATH,
  MY_RECEIPTS_PATH,
  buildReceiptLogHref,
  parseReceiptLogFiltersFromParams,
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

export default async function MyReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  const params = await searchParams;

  // Parse URL filters but never trust a user= param for ownership — stripped in dashboard.
  const filters = parseReceiptLogFiltersFromParams(
    (key) => paramString(params[key]),
    (key) => paramStringList(params[key]),
  );

  const offsetRaw = Number(paramString(params.offset) ?? "0");
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const dashboard = await getMyReceiptLogDashboard({
    ownerUserId: user.id,
    filters,
    limit: PAGE_SIZE,
    offset,
  });

  const hasMore = offset + dashboard.rows.length < dashboard.totalMatching;
  const nextOffset = offset + PAGE_SIZE;
  const exportHref = buildReceiptLogHref(filters, MY_RECEIPTS_EXPORT_PATH);

  return (
    <AppShell user={user}>
      <div className="mx-auto w-full max-w-5xl space-y-6 px-0 sm:px-0">
        <header>
          <Link href="/receipts" className="text-sm text-[var(--acton-muted)] hover:underline">
            ← Log Expense
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">My Receipts</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Your submitted expenses — check recent logs before capturing another. Inside the
            Receipts PWA scope.
          </p>
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
          initial={{ ...filters, userIds: [] }}
          userOptions={[]}
          jobOptions={dashboard.facets.jobs}
          vendorOptions={dashboard.facets.vendors}
          basePath={MY_RECEIPTS_PATH}
          showUserFilter={false}
        />

        <ReceiptLogListClient
          rows={dashboard.rows}
          filters={{ ...filters, userIds: [] }}
          totalMatching={dashboard.totalMatching}
          totalAmountCents={dashboard.totalAmountCents}
          hasMore={hasMore}
          nextOffset={nextOffset}
          exportHref={exportHref}
          basePath={MY_RECEIPTS_PATH}
          variant="mine"
        />
      </div>
    </AppShell>
  );
}
