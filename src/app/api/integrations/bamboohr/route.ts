import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { loadBambooState, runBambooCommand } from "@/lib/bamboohr/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** BambooHR connection status, diagnostics, and identity links (never tokens). */
export async function GET() {
  try {
    const ctx = await requireAiContext();
    return jsonOk(await loadBambooState(ctx));
  } catch (error) {
    return jsonError(error, "GET /api/integrations/bamboohr");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    return jsonOk({ result: (await runBambooCommand(ctx, await request.json())) ?? null });
  } catch (error) {
    return jsonError(error, "POST /api/integrations/bamboohr");
  }
}
