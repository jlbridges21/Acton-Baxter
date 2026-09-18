import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  createSiteInspection,
  createSiteInspectionSchema,
  listSiteInspections,
  type SiteInspectionStatus,
} from "@/lib/inspections";

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? undefined;
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam === "pending" || statusParam === "complete" || statusParam === "all"
        ? (statusParam as SiteInspectionStatus | "all")
        : "all";
    const inspections = await listSiteInspections({ query, status });
    return jsonOk({ inspections });
  } catch (error) {
    return jsonError(error, "GET /api/inspections");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const parsed = createSiteInspectionSchema.parse(await request.json());
    const inspection = await createSiteInspection({
      projectName: parsed.projectName,
      address: parsed.address,
      jobId: parsed.jobId ?? null,
      templateId: parsed.templateId,
      assignedTo: parsed.assignedTo ?? null,
      createdBy: user.id,
    });
    return jsonOk({ inspection }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/inspections");
  }
}
