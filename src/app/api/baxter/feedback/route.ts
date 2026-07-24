import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { upsertMessageFeedback } from "@/lib/baxter-ai/feedback";

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const body = await request.json();
    const parsed = z
      .object({
        messageId: z.string().uuid(),
        conversationId: z.string().uuid().optional().nullable(),
        rating: z.enum(["up", "down"]),
        comment: z.string().max(500).optional().nullable(),
      })
      .parse(body);

    const row = await upsertMessageFeedback({
      messageId: parsed.messageId,
      conversationId: parsed.conversationId,
      userId: user.id,
      rating: parsed.rating,
      comment: parsed.comment ?? null,
    });
    return jsonOk({ feedback: { id: row.id, rating: row.rating } });
  } catch (error) {
    return jsonError(error, "POST /api/baxter/feedback");
  }
}
