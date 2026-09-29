import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/errors";
import { buildInventoryCsv } from "@/lib/inventory/csv";
import {
  itemMatchesFilters,
  parseInventoryFilters,
  sortInventoryItems,
} from "@/lib/inventory/filters";
import { listAllInventoryItems } from "@/lib/inventory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const url = new URL(request.url);
    const filters = parseInventoryFilters(url.searchParams);
    const matched = sortInventoryItems(
      (await listAllInventoryItems()).filter((item) => itemMatchesFilters(item, filters)),
      filters.sort,
      filters.dir,
    );
    const csv = buildInventoryCsv(matched);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inventory-${stamp}.csv"`,
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
