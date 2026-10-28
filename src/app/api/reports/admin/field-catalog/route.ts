import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { newStats } from "@/lib/jobtread/client";
import { syncCustomFieldMetadata } from "@/lib/jobtread/metadata";
import { lastCatalogRefresh, searchNativeFields } from "@/lib/reports/field-catalog";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** JobTread-native field catalog (all entities), refresh status, and alias findings. */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const [result, refresh] = await Promise.all([
      searchNativeFields(ctx.access, {
        entity: url.searchParams.get("entity")?.slice(0, 40) || undefined,
        search: url.searchParams.get("search")?.slice(0, 80) || undefined,
        status: ["active", "stale", "excluded", "unsupported"].includes(status ?? "")
          ? (status as "active")
          : undefined,
        offset: Number(url.searchParams.get("offset") ?? 0) || 0,
        limit: 100,
      }),
      lastCatalogRefresh(),
    ]);
    return jsonOk({ ...result, refresh });
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/field-catalog");
  }
}

const bodySchema = z.object({
  action: z.literal("refresh"),
  /** Apply removals that a previous refresh held because the response looked incomplete. */
  confirmRemovals: z.boolean().default(false),
});

/** Refresh metadata from JobTread now (read-only on JobTread's side). */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = bodySchema.parse(await request.json());
    const result = await syncCustomFieldMetadata(newStats(), {
      triggeredBy: `admin:${ctx.user.id}`,
      confirmRemovals: body.confirmRemovals,
    });
    invalidateFieldCatalog();
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: body.confirmRemovals
        ? "reports.field_catalog_removals_confirmed"
        : "reports.field_catalog_refreshed",
      targetType: "jt_custom_fields",
      summary: `Field catalog refresh: ${result.seen} seen, ${result.added} added, ${result.renamed} renamed, ${result.removed} removed${result.heldRemovals ? `, ${result.heldRemovals} removals held` : ""}.`,
    });
    return jsonOk({ result, refresh: await lastCatalogRefresh() });
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/field-catalog");
  }
}
