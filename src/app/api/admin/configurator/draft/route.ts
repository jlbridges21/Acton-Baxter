import { jsonError, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { saveDraftSchema } from "@/lib/configurator/schemas";
import { loadAdminWorkspace } from "@/lib/configurator/server";
import { DraftConflictError, saveDraftChanges } from "@/lib/configurator/store";
import { validateCatalog } from "@/lib/configurator/validate";
import type { CatalogChange } from "@/lib/configurator/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return jsonOk(await loadAdminWorkspace());
  } catch (error) {
    return jsonError(error, "GET /api/admin/configurator/draft");
  }
}

/** Apply entity changes to the draft. Never affects the live configurator. */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = saveDraftSchema.parse(await request.json());
    const draft = await saveDraftChanges(body.changes as CatalogChange[], user.id);
    return jsonOk({
      catalog: draft.catalog,
      revision: draft.revision,
      updatedAt: draft.updatedAt,
      issues: validateCatalog(draft.catalog),
    });
  } catch (error) {
    if (error instanceof DraftConflictError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, ...error.details } },
        { status: 409 },
      );
    }
    return jsonError(error, "POST /api/admin/configurator/draft");
  }
}
