import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { alertHistory, alertInbox, updateAlertStatus } from "@/lib/reports/alerts";
import { withMigrationMessage } from "@/lib/reports/financial-http";
import { requireReportsContext } from "@/lib/reports/http";

export const dynamic = "force-dynamic";

/** Alerts addressed to the signed-in person (financial alerts need financial access). */
export async function GET(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const inbox = await alertInbox(ctx.requester, ctx.access, {
      status: status && ["open", "acknowledged", "resolved"].includes(status) ? status : undefined,
    });
    const historyId = url.searchParams.get("history");
    if (historyId && inbox.events.some((e) => e.id === historyId))
      return jsonOk({ ...inbox, history: await alertHistory(historyId) });
    return jsonOk(inbox);
  } catch (error) {
    return jsonError(error, "GET /api/reports/alerts");
  }
}

const bodySchema = z.object({
  eventId: z.string().min(1).max(80),
  action: z.enum(["acknowledge", "resolve", "reopen"]),
  note: z.string().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsContext();
    const body = bodySchema.parse(await request.json());
    const event = await withMigrationMessage(() =>
      updateAlertStatus({ ...body, requester: ctx.requester, access: ctx.access }),
    );
    return jsonOk({ event });
  } catch (error) {
    return jsonError(error, "POST /api/reports/alerts");
  }
}
