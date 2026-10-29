import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { loadLifecycleState, runLifecycleCommand } from "@/lib/hr-lifecycle/commands";

export const dynamic = "force-dynamic";

/** HR lifecycle state (cases, templates, registers), scoped to the signed-in viewer. */
export async function GET() {
  try {
    const ctx = await requireAiContext();
    return jsonOk(await loadLifecycleState(ctx));
  } catch (error) {
    return jsonError(error, "GET /api/ops/lifecycle");
  }
}

/** Validated lifecycle commands; each re-checks authorization server-side. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    const result = await runLifecycleCommand(ctx, await request.json());
    return jsonOk({ result: result ?? null });
  } catch (error) {
    return jsonError(error, "POST /api/ops/lifecycle");
  }
}
