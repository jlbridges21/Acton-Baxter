/**
 * Regenerate a read-only AI summary for one checklist item (videos required).
 * Awaits completion so the client receives the real outcome (not a fire-and-forget race).
 */
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { getSiteInspection } from "@/lib/inspections/records-store";
import { regenerateItemSummary } from "@/lib/inspections/ai/run-job";
import { upsertItemSummary, getItemSummary } from "@/lib/inspections/ai/store";
import { buildItemSummaryFingerprint } from "@/lib/inspections/ai/fingerprint";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  snapshotItemId: z.string().uuid(),
});

export async function POST(request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id: inspectionId } = await params;
    const parsed = bodySchema.parse(await request.json());

    const inspection = await getSiteInspection(inspectionId);
    const videos = inspection.media.filter(
      (m) =>
        m.snapshotItemId === parsed.snapshotItemId &&
        m.mediaType === "video" &&
        m.uploadStatus === "ready",
    );
    if (videos.length === 0) {
      throw new ValidationError("Summaries are only available for items with video");
    }

    const notes =
      inspection.responses.find((r) => r.snapshotItemId === parsed.snapshotItemId)?.notes ?? "";
    const fingerprint = buildItemSummaryFingerprint({
      notes,
      videos: videos.map((v) => ({
        mediaId: v.id,
        transcriptStatus: v.transcriptStatus,
        transcriptText: v.transcriptText,
        transcriptSegments: v.transcriptSegments,
      })),
    });

    const existing = await getItemSummary(inspectionId, parsed.snapshotItemId);
    // Keep prior text visible while regenerating — never blank the UI before success.
    await upsertItemSummary({
      inspectionId,
      snapshotItemId: parsed.snapshotItemId,
      summaryText: existing?.summaryText ?? "",
      contentFingerprint: fingerprint,
      sourceNotes: notes,
      sourceVideoIds: videos.map((v) => v.id),
      status: "processing",
      error: null,
    });

    try {
      await regenerateItemSummary({
        inspectionId,
        snapshotItemId: parsed.snapshotItemId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logServerError("POST /api/inspections/[id]/summaries/regenerate", error);
      await upsertItemSummary({
        inspectionId,
        snapshotItemId: parsed.snapshotItemId,
        summaryText: existing?.summaryText ?? "",
        contentFingerprint: fingerprint,
        sourceNotes: notes,
        sourceVideoIds: videos.map((v) => v.id),
        status: "failed",
        error: message.slice(0, 500),
      });
      const refreshed = await getSiteInspection(inspectionId);
      return jsonOk({
        inspection: refreshed,
        error: { message },
      });
    }

    const refreshed = await getSiteInspection(inspectionId);
    return jsonOk({ inspection: refreshed });
  } catch (error) {
    return jsonError(error, "POST /api/inspections/[id]/summaries/regenerate");
  }
}
