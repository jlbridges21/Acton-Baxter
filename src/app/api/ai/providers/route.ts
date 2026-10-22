import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { getProviderStatuses, testProviderConnection } from "@/lib/agents/models";
import { assertCanAdministerWorkspace } from "@/lib/agents/permissions";
import { MODEL_PROVIDERS } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

/** Provider configuration status (never secret values). */
export async function GET() {
  try {
    await requireAiContext();
    return jsonOk({ providers: getProviderStatuses() });
  } catch (error) {
    return jsonError(error, "GET /api/ai/providers");
  }
}

/** Connection test using the providers' free model-lookup endpoints. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    assertCanAdministerWorkspace(ctx.requester);
    const body = z
      .object({
        provider: z.enum(MODEL_PROVIDERS),
        model: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._:-]+$/)
          .max(100)
          .optional(),
      })
      .parse(await request.json());
    return jsonOk({ result: await testProviderConnection(body.provider, body.model) });
  } catch (error) {
    return jsonError(error, "POST /api/ai/providers");
  }
}
