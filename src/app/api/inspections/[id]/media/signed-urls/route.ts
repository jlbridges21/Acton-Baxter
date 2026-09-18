/**
 * Batch signed URLs for one checklist item's media (gallery refresh).
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getSignedUrlsForInspectionItem, itemSignedUrlsSchema } from "@/lib/inspections";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id } = await params;
    const url = new URL(request.url);
    const parsed = itemSignedUrlsSchema.parse({
      snapshotItemId: url.searchParams.get("snapshotItemId"),
    });
    const result = await getSignedUrlsForInspectionItem({
      inspectionId: id,
      snapshotItemId: parsed.snapshotItemId,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "GET /api/inspections/[id]/media/signed-urls");
  }
}
