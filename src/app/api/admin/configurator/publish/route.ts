import { jsonError, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { publishSchema } from "@/lib/configurator/schemas";
import { previewPublishPlan } from "@/lib/configurator/server";
import { getCurrentRelease, listReleases, publishDraft } from "@/lib/configurator/store";

export const dynamic = "force-dynamic";

/** What publishing now would do, plus version history. */
export async function GET() {
  try {
    await requireAdmin();
    const [plan, releases] = await Promise.all([previewPublishPlan(), listReleases()]);
    return jsonOk({ summary: plan.summary, globalErrors: plan.globalErrors, releases });
  } catch (error) {
    return jsonError(error, "GET /api/admin/configurator/publish");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = publishSchema.parse(await request.json().catch(() => ({})));
    const release = await publishDraft(body.notes, user.id);
    const live = await getCurrentRelease({ fresh: true });
    return jsonOk({
      release,
      releases: await listReleases(),
      live: live
        ? { version: live.version, publishedAt: live.publishedAt, catalog: live.snapshot.catalog }
        : null,
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/configurator/publish");
  }
}
