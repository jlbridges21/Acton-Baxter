import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { parseSlackCommandBody, postSlackResponseUrl } from "@/lib/slack/commands";
import { handleRecallSlashCommand, RECALL_USAGE } from "@/lib/slack/slash-commands";
import { verifySlackRequest } from "@/lib/slack/verify";

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
    if (!text) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: RECALL_USAGE,
      });
    }

    after(async () => {
      try {
        const ack = await handleRecallSlashCommand(payload);
        if (payload.response_url) {
          await postSlackResponseUrl(payload.response_url, ack);
        }
      } catch (error) {
        const message =
          error instanceof AppError && error.expose
            ? error.message
            : "Unable to run Slack recall right now.";
        if (payload.response_url) {
          await postSlackResponseUrl(payload.response_url, {
            response_type: "ephemeral",
            text: message,
          }).catch(() => undefined);
        }
      }
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: `Searching Slack for “${text.slice(0, 80)}${text.length > 80 ? "…" : ""}”…`,
    });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      return jsonError(error, "POST /api/slack/commands/recall");
    }
    return NextResponse.json(
      {
        response_type: "ephemeral",
        text:
          error instanceof AppError && error.expose ? error.message : "Unable to run Slack recall.",
      },
      { status: 200 },
    );
  }
}
