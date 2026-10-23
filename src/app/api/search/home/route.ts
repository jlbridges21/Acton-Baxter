import { jsonError, jsonOk } from "@/lib/api";
import { buildSearchHome } from "@/lib/search/home";
import { enforceSearchRateLimit, requireSearchContext } from "@/lib/search/http";

export const dynamic = "force-dynamic";

/** Empty-query view: recents (re-authorized), frequent tools, pinned reports, agents, categories. */
export async function GET() {
  try {
    const ctx = await requireSearchContext();
    enforceSearchRateLimit(ctx, "search-home");
    return jsonOk(await buildSearchHome(ctx), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error, "GET /api/search/home");
  }
}
