import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  getAdminSlackSnapshot,
  processOnePendingSlackJob,
  refreshSlackDisplayNames,
  runSlackAuthDiagnostic,
  runSlackPipelineDryRun,
  runSlackTestPost,
  verifyEventsConfigValues,
} from "@/lib/slack/admin";

export async function GET() {
  try {
    await requireAdmin();
    const snapshot = await getAdminSlackSnapshot();
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(error, "GET /api/admin/slack");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const parsed = z
      .object({
        action: z.enum([
          "test_auth",
          "test_post",
          "verify_events_config",
          "process_one_job",
          "pipeline_dry_run",
          "refresh_names",
        ]),
        channelOrUserId: z.string().optional(),
        text: z.string().optional(),
        question: z.string().optional(),
      })
      .parse(body);

    if (parsed.action === "test_auth") {
      return jsonOk({ result: await runSlackAuthDiagnostic() });
    }
    if (parsed.action === "refresh_names") {
      return jsonOk({ result: await refreshSlackDisplayNames() });
    }
    if (parsed.action === "test_post") {
      if (!parsed.channelOrUserId?.trim()) {
        return jsonError(
          new Error("channelOrUserId is required for test_post"),
          "POST /api/admin/slack",
        );
      }
      return jsonOk({
        result: await runSlackTestPost({
          channelOrUserId: parsed.channelOrUserId,
          text: parsed.text,
        }),
      });
    }
    if (parsed.action === "verify_events_config") {
      return jsonOk({ result: await verifyEventsConfigValues() });
    }
    if (parsed.action === "process_one_job") {
      return jsonOk({ result: await processOnePendingSlackJob() });
    }
    return jsonOk({
      result: await runSlackPipelineDryRun(parsed.question ?? "Who is Baxter?"),
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/slack");
  }
}
