import { jsonError, jsonOk } from "@/lib/api";
import { listDepartments } from "@/lib/org/departments";
import { requireReportsContext } from "@/lib/reports/http";
import { getReportStore } from "@/lib/research/report-store";

export const dynamic = "force-dynamic";

/** People and departments a report can be shared with (names only). */
export async function GET() {
  try {
    await requireReportsContext();
    const [profiles, departments] = await Promise.all([
      getReportStore().listProfiles(),
      listDepartments().catch(() => []),
    ]);
    return jsonOk({
      users: profiles
        .filter((p) => p.role !== "new_user")
        .map((p) => ({ id: p.id, name: p.full_name || "Unnamed user" })),
      departments: departments.map((d) => ({ id: d.id, name: d.name })),
      roles: [
        { id: "user", name: "All employees" },
        { id: "admin", name: "Administrators" },
      ],
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/principals");
  }
}
