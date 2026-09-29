import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { readInventoryImportJob } from "@/lib/inventory/import-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireActiveUser();
    const jobId = new URL(request.url).searchParams.get("jobId")?.trim() ?? "";
    if (!jobId) throw new ValidationError("jobId is required");
    return jsonOk(await readInventoryImportJob(jobId));
  } catch (error) {
    return jsonError(error, "GET /api/inventory/import/status");
  }
}
