import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendDexterMessage, toChatView } from "@/lib/reports/chat";
import { attachmentView, listThreadAttachments } from "@/lib/reports/attachments";
import { requireReportsContext } from "@/lib/reports/http";
import { clearSession, getSession } from "@/lib/reports/sessions";
import { clearChatMessages, listChatMessages, loadReportFor } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The signed-in user's conversation with Dexter about one report (or the unsaved draft). */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const reportId = new URL(request.url).searchParams.get("reportId");
    if (reportId) await loadReportFor(reportId, ctx.requester, ctx.access);
    const messages = await listChatMessages(ctx.user.id, reportId || null, 60);
    const session = await getSession(ctx.user.id, reportId || null);
    const attachments = await listThreadAttachments(ctx.user.id, reportId || null);
    return jsonOk({
      messages: messages.map(toChatView),
      canChat: ctx.access.canChat,
      session,
      attachments: attachments.map(attachmentView),
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/chat");
  }
}

const bodySchema = z.object({
  reportId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(4000),
  requestId: z.string().trim().min(8).max(80),
  attachmentIds: z.array(z.string().uuid()).max(6).optional(),
  focusWidgetId: z.string().max(40).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const rate = checkRateLimit(`dexter-chat:${ctx.user.id}`, { limit: 12, windowMs: 60_000 });
    if (!rate.allowed) {
      throw new AppError("Too many requests. Please wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    }
    const body = bodySchema.parse(await request.json());
    const result = await sendDexterMessage({
      ctx,
      access: ctx.access,
      reportId: body.reportId ?? null,
      message: body.message,
      requestId: body.requestId,
      attachmentIds: body.attachmentIds,
      focusWidgetId: body.focusWidgetId ?? null,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/reports/chat");
  }
}

/** "New conversation": clears the caller's own messages for this report (or the draft thread). */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const reportId = new URL(request.url).searchParams.get("reportId");
    if (reportId) await loadReportFor(reportId, ctx.requester, ctx.access);
    await clearChatMessages(ctx.user.id, reportId || null);
    await clearSession(ctx.user.id, reportId || null);
    return jsonOk({ cleared: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/chat");
  }
}
