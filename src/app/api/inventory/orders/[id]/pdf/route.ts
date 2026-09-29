import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { readInventoryOrderPdf } from "@/lib/inventory/import-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireActiveUser();
    const { id } = await context.params;
    const file = await readInventoryOrderPdf(id);
    if (!file) throw new NotFoundError("Order PDF not found");
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/inventory/orders/[id]/pdf");
  }
}
