import { jsonError, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { assetClassificationSchema } from "@/lib/configurator/schemas";
import { toAdminAsset } from "@/lib/configurator/server";
import { updateAssetClassification } from "@/lib/configurator/store";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Correct what an image shows (used by the mapping review). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new ValidationError("Invalid image id.");
    const body = z
      .object({ classification: assetClassificationSchema })
      .parse(await request.json());
    const asset = await updateAssetClassification(id, body.classification);
    return jsonOk({ asset: toAdminAsset(asset) });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/configurator/assets/[id]");
  }
}
