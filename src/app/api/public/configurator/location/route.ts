import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { issueLocationToken, resolveLocation } from "@/lib/configurator/location";
import { enforceRateLimit, isAdminPreview } from "@/lib/configurator/request-context";
import { locationRequestSchema } from "@/lib/configurator/schemas";
import { loadPricingCatalog } from "@/lib/configurator/server";

export const dynamic = "force-dynamic";

/**
 * Resolve the customer's property city to a pricing region. Returns a signed location
 * token on success; prices are never part of this response.
 */
export async function POST(request: Request) {
  try {
    enforceRateLimit(request, "location", 20);
    const url = new URL(request.url);
    const preview = await isAdminPreview(url.searchParams.get("preview") === "draft");
    const input = locationRequestSchema.parse(await request.json());
    const catalog = await loadPricingCatalog({ preview });
    const result = resolveLocation(catalog?.regions ?? [], input);
    const headers = { "Cache-Control": "no-store" };
    if (result.status === "supported") {
      return NextResponse.json(
        {
          status: "supported",
          city: result.city,
          state: result.state,
          regionName: result.regionName,
          token: issueLocationToken(result.city, result.state),
        },
        { headers },
      );
    }
    return NextResponse.json(result, { headers });
  } catch (error) {
    return jsonError(error, "POST /api/public/configurator/location");
  }
}
