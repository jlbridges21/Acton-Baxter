import { jsonError, jsonOk } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { getResolvedAgent } from "@/lib/agents/registry";
import { resolveModelTarget } from "@/lib/agents/models";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEXTER_SLUG } from "@/lib/reports/access";
import {
  deleteAttachment,
  getAttachmentFor,
  listThreadAttachments,
  MAX_ATTACHMENTS_PER_MESSAGE,
  uploadAttachment,
  attachmentView,
} from "@/lib/reports/attachments";
import { requireReportsContext } from "@/lib/reports/http";
import { loadReportFor } from "@/lib/reports/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The signed-in user's attachments for a report thread (or the draft thread). */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const reportId = new URL(request.url).searchParams.get("reportId") || null;
    if (reportId) await loadReportFor(reportId, ctx.requester, ctx.access);
    return jsonOk({
      attachments: (await listThreadAttachments(ctx.user.id, reportId)).map(attachmentView),
    });
  } catch (error) {
    return jsonError(error, "GET /api/reports/chat/attachments");
  }
}

/** Upload one or more files (multipart "file" fields, optional "reportId"). */
export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    if (!ctx.access.canChat)
      throw new ValidationError("Attaching files to Dexter needs “Chat directly” access.");
    const rate = checkRateLimit(`dexter-upload:${ctx.user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rate.allowed)
      throw new AppError("Too many uploads. Please wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    const form = await request.formData();
    const reportId = (form.get("reportId") as string | null) || null;
    if (reportId) await loadReportFor(reportId, ctx.requester, ctx.access);
    const files = form
      .getAll("file")
      .filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
    if (!files.length) throw new ValidationError("Choose a file to attach.");
    if (files.length > MAX_ATTACHMENTS_PER_MESSAGE)
      throw new ValidationError(`Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`);
    const dexter = await getResolvedAgent(DEXTER_SLUG);
    const visionModel = dexter
      ? resolveModelTarget(dexter.config.model)
      : { provider: "anthropic", model: "claude-opus-5-5" };
    const results = [];
    for (const file of files) {
      try {
        const row = await uploadAttachment({
          userId: ctx.user.id,
          reportId,
          filename: file.name,
          buffer: Buffer.from(await file.arrayBuffer()),
          visionModel,
        });
        results.push(attachmentView(row));
      } catch (error) {
        results.push({
          filename: file.name,
          status: "rejected",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    }
    return jsonOk({ attachments: results }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/reports/chat/attachments");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ValidationError("Missing attachment id.");
    await deleteAttachment(await getAttachmentFor(id, ctx.user.id));
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/reports/chat/attachments");
  }
}
