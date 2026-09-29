import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { softDeleteInventoryItems } from "@/lib/inventory/store";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, "Select at least one item"),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = bodySchema.parse(await request.json());
    const deleted = await softDeleteInventoryItems(body.ids, user.id);
    return jsonOk({ deleted });
  } catch (error) {
    return jsonError(error, "POST /api/inventory/delete");
  }
}
