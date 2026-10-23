import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { requireReportsContext } from "@/lib/reports/http";
import {
  deleteReport,
  isPinned,
  loadReportFor,
  recordView,
  saveReportVersion,
  setPinned,
  updateReportMeta,
} from "@/lib/reports/repo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reportId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission, shares } = await loadReportFor(reportId, ctx.requester, ctx.access);
    await recordView(report.id, ctx.user.id).catch(() => undefined);
    return jsonOk({
      report: {
        id: report.id,
        title: report.title,
        description: report.description,
        ownerId: report.owner_id,
        isMine: report.owner_id !== null && report.owner_id === ctx.user.id,
        visibility: report.visibility,
        isTemplate: report.is_template,
        status: report.status,
        pinned: await isPinned(report.id, ctx.user.id),
        version: report.version,
        spec: report.spec,
        updatedAt: report.updated_at,
        createdByDexter: report.created_by_agent,
      },
      permission,
      shareCount: shares.length,
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]");
  }
}

const saveSchema = z.object({
  spec: z.unknown(),
  expectedVersion: z.number().int().positive(),
  summary: z.string().trim().max(500).optional(),
});

/** Save the editor's spec as a new version (validated server-side). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    if (!permission.canEdit)
      throw new AuthorizationError(
        "You can view this report but not edit it. Duplicate it to make your own copy.",
      );
    const body = saveSchema.parse(await request.json());
    const saved = await saveReportVersion({
      report,
      spec: body.spec,
      authorId: ctx.user.id,
      authorKind: "user",
      summary: body.summary ?? null,
      expectedVersion: body.expectedVersion,
    });
    return jsonOk({
      version: saved.report.version,
      changes: saved.changes,
      spec: saved.report.spec,
    });
  } catch (error) {
    return jsonError(error, "PUT /api/reports/[reportId]");
  }
}

const metaSchema = z
  .object({
    visibility: z.enum(["private", "shared", "company"]).optional(),
    status: z.enum(["active", "archived"]).optional(),
    pinned: z.boolean().optional(),
    ownerId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const body = metaSchema.parse(await request.json());
    if ((body.visibility || body.ownerId) && !permission.canShare)
      throw new AuthorizationError("Only the owner or an administrator can change sharing.");
    if (body.status && !(permission.canDelete || (report.is_template && permission.canEdit)))
      throw new AuthorizationError("Only the owner or an administrator can archive this report.");
    if (report.is_template && body.visibility)
      throw new ValidationError("Templates are always visible to everyone with Reports access.");
    if (body.ownerId) {
      const { getReportStore } = await import("@/lib/research/report-store");
      const target = (await getReportStore().listProfiles()).find((p) => p.id === body.ownerId);
      if (!target || target.role === "new_user")
        throw new ValidationError("Choose an active employee as the new owner.");
    }
    // Renaming is an edit: saved as a new version so history (and group filing) is preserved.
    let current = report;
    if (body.title && body.title !== report.title) {
      if (!permission.canEdit)
        throw new AuthorizationError("You can view this report but not rename it.");
      current = (
        await saveReportVersion({
          report,
          spec: { ...report.spec, title: body.title },
          authorId: ctx.user.id,
          authorKind: "user",
          summary: `Renamed to "${body.title}"`,
        })
      ).report;
    }
    // Pins are personal: anyone who can view a report can pin it for themselves.
    if (body.pinned !== undefined) await setPinned(report.id, ctx.user.id, body.pinned);
    const meta = {
      ...(body.visibility ? { visibility: body.visibility } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.ownerId ? { owner_id: body.ownerId } : {}),
    };
    const updated = Object.keys(meta).length ? await updateReportMeta(current, meta) : current;
    return jsonOk({
      visibility: updated.visibility,
      status: updated.status,
      pinned: await isPinned(report.id, ctx.user.id),
      ownerId: updated.owner_id,
      title: updated.title,
    });
  } catch (error) {
    return jsonError(error, "PATCH /api/reports/[reportId]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    if (!permission.canDelete)
      throw new AuthorizationError("Only the owner or an administrator can delete this report.");
    await deleteReport(report);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/[reportId]");
  }
}
