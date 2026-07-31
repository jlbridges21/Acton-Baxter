import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { searchProjectSetupContacts } from "@/lib/project-setup/service";

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`project-setup-search:${user.id}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      throw new AppError("Enter at least 2 characters to search", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const contacts = await searchProjectSetupContacts(q);
    return jsonOk({ contacts });
  } catch (error) {
    return jsonError(error, "GET /api/projects/setup/contacts");
  }
}
