import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { requireReportsAdmin } from "@/lib/reports/http";
import {
  archiveCompanyRelationship,
  listCompanyRelationships,
} from "@/lib/reports/relationship-store";

export const dynamic = "force-dynamic";

/** Company-wide relationships promoted from reports. */
export async function GET() {
  try {
    await requireReportsAdmin();
    const rows = await listCompanyRelationships();
    return jsonOk({
      relationships: rows.map((r) => ({
        key: r.key,
        definition: r.definition,
        promotedFromReport: r.promoted_from_report,
        updatedAt: r.updated_at,
      })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/relationships");
  }
}

/** Retire a company relationship (reports that define their own copy keep working). */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const key = z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,40}$/)
      .parse(new URL(request.url).searchParams.get("key"));
    await archiveCompanyRelationship(key, ctx.access);
    await recordAudit({
      actor: { userId: ctx.user.id, label: ctx.requester.label },
      action: "reports.relationship_archived",
      targetType: "bi_report_relationship",
      targetId: key,
      summary: `Archived company relationship ${key}.`,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/admin/relationships");
  }
}
