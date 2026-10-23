import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requireReportsContext } from "@/lib/reports/http";
import { loadReportFor } from "@/lib/reports/repo";
import { getOrCreateSession, updateSession } from "@/lib/reports/sessions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reportId: z.string().uuid().nullable().optional(),
  answers: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
        answer: z.string().trim().min(1).max(600),
      }),
    )
    .min(1)
    .max(12),
});

/** Record answers to Dexter's open questions (the chat then asks Dexter to continue). */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = bodySchema.parse(await request.json());
    const reportId = body.reportId ?? null;
    if (reportId) await loadReportFor(reportId, ctx.requester, ctx.access);
    const session = await getOrCreateSession(ctx.user.id, reportId);
    const known = new Map((session.requirements.questions ?? []).map((q) => [q.id, q]));
    const questions = body.answers
      .filter((a) => known.has(a.id))
      .map((a) => ({ ...known.get(a.id)!, status: "answered" as const, answer: a.answer }));
    const updated = await updateSession(session, { requirements: { questions } });
    return jsonOk({ session: updated });
  } catch (error) {
    return jsonError(error, "PATCH /api/reports/session");
  }
}
