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
import { runSlackSearchAdminTest } from "@/lib/baxter-data/slack/diagnostics";

export async function GET() {
  try {
    const admin = await requireAdmin();
    const snapshot = await getAdminSlackSnapshot({ adminUserId: admin.profile.id });
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(error, "GET /api/admin/slack");
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
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
          "test_public_search",
          "test_user_resolution",
          "test_channel_resolution",
          "test_thread_retrieval",
          "test_latest_message",
          "sandbox_search",
        ]),
        channelOrUserId: z.string().optional(),
        text: z.string().optional(),
        question: z.string().optional(),
        query: z.string().optional(),
        teamId: z.string().optional(),
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
    if (
      parsed.action === "test_public_search" ||
      parsed.action === "test_user_resolution" ||
      parsed.action === "test_channel_resolution" ||
      parsed.action === "test_thread_retrieval" ||
      parsed.action === "test_latest_message" ||
      parsed.action === "sandbox_search"
    ) {
      return jsonOk({
        result: await runSlackSearchAdminTest({
          action: parsed.action,
          query: parsed.query ?? parsed.question,
          teamId: parsed.teamId,
          requester: {
            baxterUserId: admin.profile.id,
            allowPublicOnlyFallback: true,
          },
        }),
      });
    }
    return jsonOk({
      result: await runSlackPipelineDryRun(parsed.question ?? "Who is Baxter?"),
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/slack");
  }
}
