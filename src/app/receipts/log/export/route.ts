import { NextResponse } from "next/server";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/errors";
import { buildReceiptLogCsv } from "@/lib/receipts/csv";
import { getReceiptLogDashboard } from "@/lib/receipts/log-dashboard";
import {
  parseFeedbackRangePreset,
  parseReceiptLogDateField,
  parseReceiptLogEntryType,
  parseReceiptLogSortDir,
  parseReceiptLogSortField,
  type ReceiptLogFiltersState,
} from "@/lib/receipts/log-filter-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function paramList(url: URL, key: string): string[] {
  const values = url.searchParams.getAll(key);
  const out: string[] = [];
  const seen = new Set<string>();
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

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    if (!isAdminRole(user.profile.role)) {
      throw new AuthorizationError("Admin access required");
    }

    const url = new URL(request.url);
    const filters: ReceiptLogFiltersState = {
      range: parseFeedbackRangePreset(url.searchParams.get("range")),
      dateField: parseReceiptLogDateField(url.searchParams.get("dateField")),
      customStart: url.searchParams.get("start") ?? "",
      customEnd: url.searchParams.get("end") ?? "",
      userIds: paramList(url, "user"),
      jobIds: paramList(url, "job"),
      vendors: paramList(url, "vendor"),
      amountMin: url.searchParams.get("amountMin") ?? "",
      amountMax: url.searchParams.get("amountMax") ?? "",
      entryType: parseReceiptLogEntryType(url.searchParams.get("entryType")),
      q: url.searchParams.get("q") ?? "",
      sort: parseReceiptLogSortField(url.searchParams.get("sort")),
      dir: parseReceiptLogSortDir(url.searchParams.get("dir")),
    };

    const dashboard = await getReceiptLogDashboard({
      filters,
      skipSignedUrls: true,
    });

    const origin = url.origin;
    const csv = buildReceiptLogCsv(dashboard.rows, origin);
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="receipt-log-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: { code: "EXPORT_FAILED", message } }, { status: 500 });
  }
}
