import { requireUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAddressProvider } from "@/lib/address/resolve";

type RouteContext = {
  params: Promise<{ placeId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const rate = checkRateLimit(`address-place:${user.id}`, { limit: 40, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const { placeId: rawPlaceId } = await context.params;
    const placeId = decodeURIComponent(rawPlaceId).trim();
    if (!placeId || placeId.length > 300) {
      throw new ValidationError("Invalid place id");
    }

    const provider = getAddressProvider();
    if (!provider.isConfigured()) {
      throw new ValidationError(
        "Address details are unavailable because Google Maps is not configured.",
      );
    }

    const address = await provider.getPlaceDetails(placeId);
    return jsonOk({ address });
  } catch (error) {
    return jsonError(error, "GET /api/address/place/[placeId]");
  }
}
