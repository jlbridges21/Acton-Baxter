import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { loadTemplate } from "@/lib/ops/commands";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAiContext();
    const { id } = await params;
    return jsonOk(await loadTemplate(ctx, id));
  } catch (error) {
    return jsonError(error, "GET /api/ops/templates/[id]");
  }
}
