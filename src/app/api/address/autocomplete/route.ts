import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAddressProvider } from "@/lib/address/resolve";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const rate = checkRateLimit(`address-autocomplete:${user.id}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("query") ?? "").trim();
    if (query.length < 3) {
      throw new ValidationError("Enter at least 3 characters to search addresses");
    }
    if (query.length > 200) {
      throw new ValidationError("Address query is too long");
    }

    const provider = getAddressProvider();
    if (!provider.isConfigured()) {
      return jsonOk({
        suggestions: [],
        configured: false,
        message:
          "Address autocomplete is not configured. Ask an admin to add Google Maps API keys.",
      });
    }

    const suggestions = await provider.autocomplete(query);
    return jsonOk({ suggestions, configured: true });
  } catch (error) {
    return jsonError(error, "GET /api/address/autocomplete");
  }
}
