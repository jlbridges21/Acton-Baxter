import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AuthorizationError } from "@/lib/errors";
import { loadProfileDisplayByIds } from "@/lib/auth/load-profile-display";
import { requireReportsContext } from "@/lib/reports/http";
import { listRevisions, loadReportFor, restoreRevision } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reportId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report } = await loadReportFor(reportId, ctx.requester, ctx.access);
    const revisions = await listRevisions(report.id);
    const names = await loadProfileDisplayByIds(
      revisions.map((r) => r.author_id).filter((x): x is string => Boolean(x)),
    ).catch(() => new Map());
    return jsonOk({
      current: report.version,
      revisions: revisions.map((r) => ({
        version: r.version,
        title: r.title,
        summary: r.change_summary,
        authorKind: r.author_kind,
        authorName:
          r.author_kind === "dexter"
            ? "Dexter"
            : r.author_kind === "system"
              ? "System"
              : (r.author_id && names.get(r.author_id)?.displayName) || "Someone",
        createdAt: r.created_at,
        spec: r.spec,
      })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/[reportId]/revisions");
  }
}

const restoreSchema = z.object({ version: z.number().int().positive() });

/** Restore copies an old version forward as a new version; history is never rewritten. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireReportsContext();
    const { reportId } = await params;
    const { report, permission } = await loadReportFor(reportId, ctx.requester, ctx.access);
    if (!permission.canEdit) throw new AuthorizationError("You can't change this report.");
    const { version } = restoreSchema.parse(await request.json());
    const saved = await restoreRevision(report, version, ctx.user.id);
    return jsonOk({ version: saved.report.version, spec: saved.report.spec });
  } catch (error) {
    return jsonError(error, "POST /api/reports/[reportId]/revisions");
  }
}
