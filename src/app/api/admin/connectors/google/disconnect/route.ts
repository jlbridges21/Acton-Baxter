import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  decryptConnectionRefreshToken,
  disconnectGoogleConnection,
  getActiveGoogleConnection,
  revokeGoogleRefreshToken,
} from "@/lib/connectors/google/connections";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const parsed = z
      .object({
        archiveKnowledge: z.boolean().optional().default(false),
        confirm: z.literal(true),
      })
      .parse(body);

    const active = await getActiveGoogleConnection();
    if (active?.encrypted_refresh_token) {
      try {
        const refresh = decryptConnectionRefreshToken(active);
        await revokeGoogleRefreshToken(refresh);
      } catch {
        // best-effort
      }
    }

    const result = await disconnectGoogleConnection({
      connectionId: active?.id,
      archiveKnowledge: parsed.archiveKnowledge,
      adminUserId: user.id,
    });

    return jsonOk({
      ...result,
      message: parsed.archiveKnowledge
        ? "Google disconnected. Google-managed Knowledge entries were archived."
        : "Google disconnected. Existing Knowledge entries were preserved and will no longer sync.",
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/google/disconnect");
  }
}
