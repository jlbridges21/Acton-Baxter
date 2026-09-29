import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { inventoryVocabWriteSchema } from "@/lib/inventory/schemas";
import { createInventoryVocab, listInventoryVocab } from "@/lib/inventory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const [statuses, storageStates] = await Promise.all([
      listInventoryVocab("status"),
      listInventoryVocab("storage"),
    ]);
    return jsonOk({ statuses, storageStates });
  } catch (error) {
    return jsonError(error, "GET /api/admin/inventory-vocab");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = inventoryVocabWriteSchema.parse(await request.json());
    const value = await createInventoryVocab(body);
    return jsonOk({ value }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/inventory-vocab");
  }
}
