import { after, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifySlackRequest } from "@/lib/slack/verify";
import { jsonError } from "@/lib/api";
import { handleNewProjectViewSubmission } from "@/lib/project-setup/new-project-slack";

/**
 * Slack interactivity endpoint — view_submission for /new-project modals.
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

    const params = new URLSearchParams(rawBody);
    const payloadRaw = params.get("payload");
    if (!payloadRaw) {
      return NextResponse.json({ ok: true });
    }

    let payload: {
      type?: string;
      user?: { id?: string };
      team?: { id?: string };
      view?: {
        id?: string;
        hash?: string;
        callback_id?: string;
        private_metadata?: string;
        state?: {
          values?: Record<
            string,
            Record<string, { value?: string; selected_option?: { value?: string } }>
          >;
        };
      };
    };
    try {
      payload = JSON.parse(payloadRaw) as typeof payload;
    } catch {
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
        const response = await handleNewProjectViewSubmission(payload, (work) => {
          after(() => {
            void work().catch((error) => {
              console.error("[slack/interactions] new-project async failed", error);
            });
          });
        });
        return NextResponse.json(response);
      }
    }

    // Acknowledge unknown/legacy interactive payloads (including old PEM modals).
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/slack/interactions");
  }
}
