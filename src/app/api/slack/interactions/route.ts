import { after, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifySlackRequest } from "@/lib/slack/verify";
import { jsonError } from "@/lib/api";
import { parseSlackInteractionPayload } from "@/lib/slack/interaction-payload";
import {
  buildViewSubmissionErrorResponse,
  handleNewProjectViewSubmission,
} from "@/lib/project-setup/new-project-slack";

export const runtime = "nodejs";

/**
 * Slack interactivity endpoint — view_submission for /new-project modals.
 * Request URL: https://acton-baxter.vercel.app/api/slack/interactions
 *
 * Slack sends form-urlencoded bodies with a `payload` JSON field. Never use request.json().
 * view_submission must always return a Slack-valid response_action body — never jsonError.
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

    const payload = parseSlackInteractionPayload(rawBody);
    if (!payload) {
      return NextResponse.json({ ok: true });
    }

    if (payload.type === "view_submission") {
      const callbackId = payload.view?.callback_id ?? "";
      if (
        callbackId.startsWith("project_setup_") ||
        callbackId === "project_setup_search" ||
        callbackId === "project_setup_pick" ||
        callbackId === "project_setup_confirm"
      ) {
        try {
          const response = await handleNewProjectViewSubmission(payload, (work) => {
            after(() => {
              void work().catch((error) => {
                console.error("[slack/interactions] new-project async failed", error);
              });
            });
          });
          return NextResponse.json(response);
        } catch (error) {
          // Second-layer safety: never let view_submission fall through to jsonError.
          console.error("[slack/interactions] view_submission handler threw", {
            callbackId,
            slackUserId: payload.user?.id ?? null,
            message: error instanceof Error ? error.message : String(error),
          });
          return NextResponse.json(
            buildViewSubmissionErrorResponse({
              callbackId,
              message: "Something went wrong — try /new-project again.",
            }),
          );
        }
      }
    }

    // Acknowledge unknown/legacy interactive payloads (including old PEM modals).
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Signature failures and non-view_submission errors may still use jsonError.
    return jsonError(error, "POST /api/slack/interactions");
  }
}
