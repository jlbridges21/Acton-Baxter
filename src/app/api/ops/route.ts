import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { loadOpsState, runOpsCommand } from "@/lib/ops/commands";

export const dynamic = "force-dynamic";

/** Sam Operations Studio state, scoped to the signed-in viewer. */
export async function GET() {
  try {
    const ctx = await requireAiContext();
    return jsonOk(await loadOpsState(ctx));
  } catch (error) {
    return jsonError(error, "GET /api/ops");
  }
}

/** Validated Studio commands; each re-checks authorization server-side. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    const result = await runOpsCommand(ctx, await request.json());
    return jsonOk({ result: result ?? null });
  } catch (error) {
    return jsonError(error, "POST /api/ops");
  }
}
