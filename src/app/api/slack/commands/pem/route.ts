import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { parseSlackCommandBody } from "@/lib/slack/commands";
import { handlePemSlashCommand } from "@/lib/slack/slash-commands";
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
    // views.open must use trigger_id within ~3s — handle synchronously.
    const ack = await handlePemSlashCommand(payload);
    return NextResponse.json(ack);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      return jsonError(error, "POST /api/slack/commands/pem");
    }
    return NextResponse.json(
      {
        response_type: "ephemeral",
        text:
          error instanceof AppError && error.expose
            ? error.message
            : "Unable to open the PEM NEAT form.",
      },
      { status: 200 },
    );
  }
}
