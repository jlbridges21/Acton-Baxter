import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifySlackRequest } from "@/lib/slack/verify";
import { jsonError } from "@/lib/api";

/**
 * Minimal interactions endpoint — acknowledges Slack interactive payloads.
 * Version 1 only needs slash-command support; keep this route for Slack app config.
 */
export async function POST(request: Request) {
  try {
    const env = getEnv();
    if (!env.ENABLE_SLACK_INTEGRATION) {
      return NextResponse.json({ ok: true });
    }

    const rawBody = await request.text();
    verifySlackRequest({
      signature: request.headers.get("x-slack-signature"),
      timestamp: request.headers.get("x-slack-request-timestamp"),
      rawBody,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/slack/interactions");
  }
}
