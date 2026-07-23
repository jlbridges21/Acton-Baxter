import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import {
  handlePropertySlashCommand,
  parseSlackCommandBody,
  postSlackResponseUrl,
} from "@/lib/slack/commands";
import { verifySlackRequest } from "@/lib/slack/verify";

/**
 * Acknowledge Slack within ~3s, then run geocode + queue work in `after()`.
 * Slow Google/Supabase work previously caused Slack `operation_timeout`.
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
    const text = (payload.text ?? "").trim();
    const commandName = env.SLACK_COMMAND_NAME || "/property";

    if (!text) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Usage: ${commandName} <California property address>`,
      });
    }

    const allowedTeams = new Set(
      env.SLACK_ALLOWED_TEAM_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (!payload.team_id || !allowedTeams.has(payload.team_id)) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "This Slack workspace is not authorized.",
      });
    }

    after(async () => {
      try {
        const ack = await handlePropertySlashCommand(payload);
        if (payload.response_url) {
          await postSlackResponseUrl(payload.response_url, ack);
        }
      } catch (error) {
        const message =
          error instanceof AppError && error.expose
            ? error.message
            : error instanceof ValidationError
              ? error.message
              : "Unable to start property research from Slack.";
        if (payload.response_url) {
          await postSlackResponseUrl(payload.response_url, {
            response_type: "ephemeral",
            text: message,
          }).catch((postError) => {
            console.error("[slack/property] response_url failed", postError);
          });
        } else {
          console.error("[slack/property] background failed", error);
        }
      }
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: `Starting property research for “${text}”… You will receive another message when the report is queued or if the address needs clarification.`,
    });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      return jsonError(error, "POST /api/slack/commands/property");
    }

    const publicMessage =
      error instanceof AppError && error.expose
        ? error.message
        : "Unable to start property research from Slack.";

    return NextResponse.json(
      {
        response_type: "ephemeral",
        text: publicMessage,
      },
      { status: 200 },
    );
  }
}
