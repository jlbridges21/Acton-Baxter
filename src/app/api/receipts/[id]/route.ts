import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { softDeleteReceipt } from "@/lib/receipts";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const receipt = await softDeleteReceipt(id);
    return jsonOk({ receipt });
  } catch (error) {
    return jsonError(error, "DELETE /api/receipts/[id]");
  }
}
