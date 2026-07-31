import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildProjectSetupPreview,
  loadProjectSetupContactSnapshot,
} from "@/lib/project-setup/service";

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`project-setup-preview:${user.id}`, {
      limit: 40,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contactId")?.trim();
    if (!contactId) {
      throw new AppError("contactId is required", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const contact = await loadProjectSetupContactSnapshot(contactId);
    const preview = await buildProjectSetupPreview({
      contact,
      salesRep: searchParams.get("salesRep"),
      projectNumber: searchParams.get("projectNumber"),
      fpPaidDate: searchParams.get("fpPaidDate"),
      lastNameOverride: searchParams.get("lastName"),
    });

    return jsonOk({ preview });
  } catch (error) {
    return jsonError(error, "GET /api/projects/setup/preview");
  }
}
