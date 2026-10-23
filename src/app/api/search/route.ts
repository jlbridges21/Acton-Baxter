import { jsonError } from "@/lib/api";
import {
  enforceSearchRateLimit,
  requireSearchContext,
  searchParamsSchema,
  searchStream,
} from "@/lib/search/http";

export const dynamic = "force-dynamic";

/** Global Search: streams one NDJSON event per provider as it finishes. */
export async function GET(request: Request) {
  try {
    const ctx = await requireSearchContext();
    enforceSearchRateLimit(ctx);
    const url = new URL(request.url);
    const params = searchParamsSchema.parse({
      q: url.searchParams.get("q") ?? "",
      category: url.searchParams.get("category") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    return searchStream(ctx, params, request.signal);
  } catch (error) {
    return jsonError(error, "GET /api/search");
  }
}
