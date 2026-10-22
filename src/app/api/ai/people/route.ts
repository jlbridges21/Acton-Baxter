import { jsonError, jsonOk } from "@/lib/api";
import { isAppAccessRole } from "@/lib/auth/roles";
import { requireAiContext } from "@/lib/agents/http";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { listDepartments } from "@/lib/org/departments";
import { getReportStore } from "@/lib/research/report-store";

export const dynamic = "force-dynamic";

/** People and (human) departments for the access-policy picker. Admin only; names and roles only. */
export async function GET() {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const [profiles, departments] = await Promise.all([
      getReportStore().listProfiles(),
      listDepartments({ includeInactive: false }).catch(() => []),
    ]);
    return jsonOk({
      people: profiles
        .filter((p) => isAppAccessRole(p.role))
        .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
      departments: departments.map((d) => ({ id: d.id, name: d.name })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/ai/people");
  }
}
