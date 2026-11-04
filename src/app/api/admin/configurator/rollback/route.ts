import { jsonError, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { rollbackSchema } from "@/lib/configurator/schemas";
import { getCurrentRelease, listReleases, rollbackToVersion } from "@/lib/configurator/store";

export const dynamic = "force-dynamic";

/** Make an older published version live again (as a new version). The draft is untouched. */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = rollbackSchema.parse(await request.json());
    const release = await rollbackToVersion(body.version, user.id);
    const live = await getCurrentRelease({ fresh: true });
    return jsonOk({
      release,
      releases: await listReleases(),
      live: live
        ? { version: live.version, publishedAt: live.publishedAt, catalog: live.snapshot.catalog }
        : null,
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/configurator/rollback");
  }
}
