import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { inventoryBulkSchema } from "@/lib/inventory/schemas";
import { bulkUpdateInventoryItems } from "@/lib/inventory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = inventoryBulkSchema.parse(await request.json());
    const patch = body.patch;
    const touched =
      patch.statusId !== undefined ||
      patch.storageStateId !== undefined ||
      patch.deliveryDate !== undefined ||
      patch.outDate !== undefined;
    if (!touched) {
      throw new ValidationError("Choose at least one field to update");
    }
    const updated = await bulkUpdateInventoryItems({
      ids: body.ids,
      patch,
      actorId: user.id,
    });
    return jsonOk({ updated });
  } catch (error) {
    return jsonError(error, "POST /api/inventory/bulk");
  }
}
