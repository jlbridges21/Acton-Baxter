import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { loadInstance } from "@/lib/ops/commands";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    return jsonOk(await loadInstance(ctx, id));
  } catch (error) {
    return jsonError(error, "GET /api/ops/instances/[id]");
  }
}
