import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { parseSlackCommandBody, postSlackResponseUrl } from "@/lib/slack/commands";
import { verifySlackRequest } from "@/lib/slack/verify";
import { isSlackTeamAllowed, isSlackUserAllowed } from "@/lib/slack/config";
import { openNewProjectModal } from "@/lib/project-setup/new-project-async";

/**
 * /new-project — open the GHL search → confirm modal within Slack's 3s window.
 * Request URL: https://acton-baxter.vercel.app/api/slack/commands/new-project
 */
export async function POST(request: Request) {
  try {
    const env = getEnv();
    if (!env.ENABLE_SLACK_INTEGRATION) {
      return NextResponse.json(
        { response_type: "ephemeral", text: "Slack integration is disabled." },
        { status: 503 },
      );
    }

    const rawBody = await request.text();
    verifySlackRequest({
      signature: request.headers.get("x-slack-signature"),
      timestamp: request.headers.get("x-slack-request-timestamp"),
      rawBody,
    });

    const payload = parseSlackCommandBody(rawBody);

    if (!payload.team_id || !isSlackTeamAllowed(payload.team_id)) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "This Slack workspace is not authorized.",
      });
    }

    if (!payload.user_id || !isSlackUserAllowed(payload.user_id)) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "You’re not on the Baxter Slack allowlist for /new-project. Ask an admin if you need access.",
      });
    }

    if (!payload.trigger_id) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Slack did not send a trigger_id — try /new-project again.",
      });
    }

    // Open the modal ASAP (must use trigger_id within ~3s). Prefer sync open;
    // fall back to after()+ephemeral only if open throws after we already need to ack.
    try {
      await openNewProjectModal(payload);
      return new NextResponse(null, { status: 200 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to open the new-project modal.";
      after(async () => {
        if (payload.response_url) {
          await postSlackResponseUrl(payload.response_url, {
            response_type: "ephemeral",
            text: message,
          }).catch(() => undefined);
        }
      });
      return NextResponse.json({
        response_type: "ephemeral",
        text: message,
      });
    }
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      return jsonError(error, "POST /api/slack/commands/new-project");
    }

    const publicMessage =
      error instanceof AppError && error.expose ? error.message : "Unable to start /new-project.";

    return NextResponse.json(
      {
        response_type: "ephemeral",
        text: publicMessage,
      },
      { status: 200 },
    );
  }
}
