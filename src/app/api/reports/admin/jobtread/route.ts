import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { recordAudit } from "@/lib/agents/audit";
import { agentDb } from "@/lib/agents/store";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { getConnectionRow, runFullSync, testConnection } from "@/lib/jobtread/sync";
import { getDataSettingsOverview } from "@/lib/reports/admin";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { requireReportsAdmin } from "@/lib/reports/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Connection status, sync history, and field governance. The grant key is never returned. */
export async function GET() {
  try {
    await requireReportsAdmin();
    return jsonOk(await getDataSettingsOverview());
  } catch (error) {
    return jsonError(error, "GET /api/reports/admin/jobtread");
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("interval"), minutes: z.number().int().min(15).max(1440) }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireReportsAdmin();
    const body = actionSchema.parse(await request.json());
    const actor = { userId: ctx.user.id, label: ctx.requester.label };
    if (body.action === "test") {
      const row = await testConnection();
      await recordAudit({
        actor,
        action: "jobtread.tested",
        targetType: "jobtread",
        summary: `Tested the JobTread connection (${row.status}).`,
      });
    } else if (body.action === "sync") {
      const run = await runFullSync(`user:${ctx.user.id}`);
      invalidateFieldCatalog();
      clearJobDetailCache();
      await recordAudit({
        actor,
        action: "jobtread.synced",
        targetType: "jobtread",
        summary: `Ran a JobTread sync (${run.status}).`,
      });
    } else {
      const current = await getConnectionRow();
      await agentDb().upsert(
        "jt_connection",
        { ...current, sync_interval_minutes: body.minutes, updated_at: new Date().toISOString() },
        ["id"],
      );
      await recordAudit({
        actor,
        action: "jobtread.interval",
        targetType: "jobtread",
        summary: `Set the JobTread sync interval to ${body.minutes} minutes.`,
      });
    }
    return jsonOk(await getDataSettingsOverview());
  } catch (error) {
    return jsonError(error, "POST /api/reports/admin/jobtread");
  }
}
