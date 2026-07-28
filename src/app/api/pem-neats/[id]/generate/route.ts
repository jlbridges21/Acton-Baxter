import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, RateLimitError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { startPemNeatGeneration } from "@/lib/pem-neat/run-generation";

type RouteContext = { params: Promise<{ id: string }> };

export const maxDuration = 800;

/** Regenerate from the stored transcript (async durable job). */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`pem-neat-regen:${user.id}`, { limit: 5, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new RateLimitError();
    }

    const { id } = await context.params;
    const store = getPemNeatStore();
    const existing = await store.get(id);
    if (!existing) {
      throw new NotFoundError("PEM NEAT not found");
    }

    const started = await startPemNeatGeneration(id);
    return jsonOk({ id: started.id, status: started.status, jobId: started.jobId });
  } catch (error) {
    return jsonError(error, "POST /api/pem-neats/[id]/generate");
  }
}
