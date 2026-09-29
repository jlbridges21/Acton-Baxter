import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { parseInventoryUnitCostToCents } from "@/lib/inventory/money";
import { inventoryItemWriteSchema } from "@/lib/inventory/schemas";
import { createInventoryItem, queryInventory } from "@/lib/inventory/store";
import { parseInventoryFilters } from "@/lib/inventory/filters";
import type { InventoryItemInput } from "@/lib/inventory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInput(
  body: ReturnType<typeof inventoryItemWriteSchema.parse>,
  actorId: string,
): InventoryItemInput {
  return {
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
    actorId,
  };
}

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const url = new URL(request.url);
    const result = await queryInventory(parseInventoryFilters(url.searchParams));
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "GET /api/inventory");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = inventoryItemWriteSchema.parse(await request.json());
    const item = await createInventoryItem(toInput(body, user.id));
    return jsonOk({ item }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/inventory");
  }
}
