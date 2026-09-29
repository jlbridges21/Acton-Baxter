import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { inventoryVocabDeleteSchema, inventoryVocabUpdateSchema } from "@/lib/inventory/schemas";
import { deleteInventoryVocab, updateInventoryVocab } from "@/lib/inventory/store";
import type { InventoryVocabKind } from "@/lib/inventory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ kind: string; id: string }> };

function kindOf(raw: string): InventoryVocabKind {
  if (raw === "status" || raw === "storage") return raw;
  throw new ValidationError("Unknown vocabulary");
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { kind, id } = await context.params;
    const body = inventoryVocabUpdateSchema.parse(await request.json());
    const value = await updateInventoryVocab(kindOf(kind), id, body);
    return jsonOk({ value });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/inventory-vocab");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { kind, id } = await context.params;
    const body = inventoryVocabDeleteSchema.parse(await request.json().catch(() => ({})));
    const result = await deleteInventoryVocab(kindOf(kind), id, body.reassignToId);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "DELETE /api/admin/inventory-vocab");
  }
}
