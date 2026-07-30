import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifySlackRequest } from "@/lib/slack/verify";
import { jsonError } from "@/lib/api";

/**
 * Slack interactivity endpoint — reserved for future interactive payloads.
 * `/pem` no longer uses a modal; PEM generation happens in the Baxter web app.
 * Request URL: https://acton-baxter.vercel.app/api/slack/interactions
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

    // Acknowledge unknown/legacy interactive payloads (including old PEM modals).
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/slack/interactions");
  }
}
