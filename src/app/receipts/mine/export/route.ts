import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { buildReceiptLogCsv } from "@/lib/receipts/csv";
import { getMyReceiptLogDashboard } from "@/lib/receipts/log-dashboard";
import { parseReceiptLogFiltersFromParams } from "@/lib/receipts/log-filter-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV export of the signed-in user's own receipts only.
 * Ownership is enforced in getMyReceiptLogDashboard (listReceiptsForUser + strip userIds).
 */
export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const url = new URL(request.url);
    const filters = parseReceiptLogFiltersFromParams(
      (key) => url.searchParams.get(key),
      (key) => url.searchParams.getAll(key),
    );

    const dashboard = await getMyReceiptLogDashboard({
      ownerUserId: user.id,
      filters,
      skipSignedUrls: true,
    });

    // Extra assertion: every exported row must belong to the caller.
    for (const row of dashboard.rows) {
      if (row.submittedBy !== user.id) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Export ownership check failed" } },
          { status: 403 },
        );
      }
    }

    const csv = buildReceiptLogCsv(dashboard.rows, url.origin, { includeSubmitter: false });
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="my-receipts-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: { code: "EXPORT_FAILED", message } }, { status: 500 });
  }
}
