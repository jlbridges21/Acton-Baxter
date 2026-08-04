import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { browseUserCuratedDrive } from "@/lib/knowledge/user-drive-ingest";

/**
 * User-facing Drive browse — org connection, admin-curated folder scope only.
 */
export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId");
    const search = url.searchParams.get("search");
    const result = await browseUserCuratedDrive({ folderId, search });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "GET /api/knowledge/drive/browse");
  }
}
