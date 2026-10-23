import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordUse } from "@/lib/search/home";
import { enforceSearchRateLimit, requireSearchContext } from "@/lib/search/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.string().min(1).max(60),
  recordId: z.string().min(1).max(80),
});

/** Record that the viewer opened a result (for recents). Only visible records are stored. */
export async function POST(request: Request) {
  try {
    const ctx = await requireSearchContext();
    enforceSearchRateLimit(ctx, "search-track");
    const body = bodySchema.parse(await request.json());
    return jsonOk(await recordUse(ctx, body));
  } catch (error) {
    return jsonError(error, "POST /api/search/track");
  }
}
