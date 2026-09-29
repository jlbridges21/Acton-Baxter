import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { parseInventoryUnitCostToCents } from "@/lib/inventory/money";
import { inventoryItemWriteSchema } from "@/lib/inventory/schemas";
import { softDeleteInventoryItem, updateInventoryItem } from "@/lib/inventory/store";
import type { InventoryItemInput } from "@/lib/inventory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const { id } = await context.params;
    const body = inventoryItemWriteSchema.parse(await request.json());
    const input: InventoryItemInput = {
      itemName: body.itemName,
      sku: body.sku,
      quantity: body.quantity,
      unitCostCents: parseInventoryUnitCostToCents(body.unitCost),
      statusId: body.statusId,
      jobId: body.jobId ?? null,
      customProjectLabel: body.customProjectLabel ?? null,
      vendor: body.vendor,
      orderNumber: body.orderNumber,
      category: body.category,
      description: body.description,
      productUrl: body.productUrl,
      photoUrl: body.photoUrl,
      storageStateId: body.storageStateId,
      deliveryDate: body.deliveryDate,
      outDate: body.outDate,
      notes: body.notes,
      actorId: user.id,
    };
    const item = await updateInventoryItem(id, input);
    return jsonOk({ item });
  } catch (error) {
    return jsonError(error, "PATCH /api/inventory/[id]");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const { id } = await context.params;
    await softDeleteInventoryItem(id, user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/inventory/[id]");
  }
}
