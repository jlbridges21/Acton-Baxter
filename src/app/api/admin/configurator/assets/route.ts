import { jsonError, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { storeImage } from "@/lib/configurator/asset-storage";
import { assetClassificationSchema } from "@/lib/configurator/schemas";
import { toAdminAsset } from "@/lib/configurator/server";
import { listAssets } from "@/lib/configurator/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return jsonOk({ assets: (await listAssets()).map(toAdminAsset) });
  } catch (error) {
    return jsonError(error, "GET /api/admin/configurator/assets");
  }
}

/** Upload one image (multipart field `file`, optional JSON field `classification`). */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Choose an image to upload.");
    const rawClassification = form.get("classification");
    const classification =
      typeof rawClassification === "string" && rawClassification
        ? assetClassificationSchema.parse(JSON.parse(rawClassification))
        : null;
    const { asset, duplicate } = await storeImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName: file.name || "upload.jpg",
      mimeType: file.type,
      source: "upload",
      provenance: `Uploaded by ${user.email ?? user.id} on ${new Date().toISOString().slice(0, 10)}`,
      classification,
      userId: user.id,
    });
    return jsonOk({ asset: toAdminAsset(asset), duplicate });
  } catch (error) {
    return jsonError(error, "POST /api/admin/configurator/assets");
  }
}
