import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { AuthorizationError } from "@/lib/errors";
import { newStats } from "@/lib/jobtread/client";
import { listEntityCatalog, verifyEntityCatalog } from "@/lib/jobtread/catalog";
import { lastSuccessfulSync } from "@/lib/jobtread/sync";
import { canSeeField, CATEGORY_LABELS } from "@/lib/reports/access";
import { capabilityMatrix, STATUS_TEXT, suggestedReports } from "@/lib/reports/capabilities";
import { isBlank } from "@/lib/reports/compute";
import { ensureJobTreadData, loadSourceRows } from "@/lib/reports/engine";
import { getFieldCatalog } from "@/lib/reports/fields";
import { requireReportsContext } from "@/lib/reports/http";
import { SOURCES } from "@/lib/reports/spec";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The verified Data Catalog: JobTread entities (metadata + counts), report fields this viewer
 * may use (with fill rates), the capability matrix, and suggested reports. No record values.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    await ensureJobTreadData();
    if (new URL(request.url).searchParams.get("view") === "suggestions") {
      return jsonOk({ suggestions: await suggestedReports(ctx.access) });
    }
    const [entities, catalog, sync, jobs, matrix, suggestions] = await Promise.all([
      listEntityCatalog(),
      getFieldCatalog(),
      lastSuccessfulSync().catch(() => null),
      loadSourceRows("jobs").catch(() => ({ rows: [] })),
      capabilityMatrix(ctx.access),
      suggestedReports(ctx.access),
    ]);
    const all = [...SOURCES.flatMap((source) => catalog.bySource[source])];
    const hiddenByCategory: Record<string, number> = {};
    const fields = [];
    for (const f of all) {
      if (!canSeeField(ctx.access, f)) {
        const label = CATEGORY_LABELS[f.category];
        hiddenByCategory[label] = (hiddenByCategory[label] ?? 0) + 1;
        continue;
      }
      fields.push({
        key: f.key,
        label: f.label,
        type: f.type,
        source: f.source,
        target: f.target ?? null,
        category: f.category,
        custom: Boolean(f.customFieldId),
        options: f.options?.slice(0, 20) ?? [],
        origin: f.origin,
        description: f.description ?? null,
        filled: f.source === "jobs" ? jobs.rows.filter((r) => !isBlank(r[f.key])).length : null,
      });
    }
    const businessNames = [...catalog.semantic.entries()].map(([key, s]) => ({
      key,
      label: s.label,
      mapped: Boolean(s.ref),
      description: s.description,
    }));
    return jsonOk({
      isAdmin: ctx.access.isAdmin,
      lastSync: sync?.finished_at ?? null,
      lastVerified: entities.map((e) => e.last_verified_at).sort()[0] ?? null,
      entities,
      fields,
      totalJobs: jobs.rows.length,
      hiddenByCategory,
      businessNames,
      capabilities: matrix.map((c) => ({ ...c, statusText: STATUS_TEXT[c.status] })),
      suggestions,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/catalog");
  }
}

const actionSchema = z.object({ action: z.literal("verify") });

/** Re-verify every JobTread entity against the live API (admins; metadata and counts only). */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    if (!ctx.access.isAdmin)
      throw new AuthorizationError("Only administrators can re-verify the data catalog.");
    actionSchema.parse(await request.json());
    const stats = newStats();
    const rows = await verifyEntityCatalog(stats);
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "jobtread.catalog_verified",
      targetType: "jobtread",
      summary: `Verified the JobTread data catalog (${rows.length} entities, ${stats.requests} API calls).`,
    });
    return jsonOk({ verified: rows.length, apiRequests: stats.requests });
  } catch (error) {
    return jsonError(error, "POST /api/reports/catalog");
  }
}
