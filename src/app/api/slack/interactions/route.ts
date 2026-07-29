import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifySlackRequest } from "@/lib/slack/verify";
import { jsonError } from "@/lib/api";
import { handlePemModalSubmission, PEM_MODAL_CALLBACK_ID } from "@/lib/slack/slash-commands";
import { postSlackResponseUrl } from "@/lib/slack/commands";

/**
 * Slack interactivity endpoint — PEM modal submissions and future interactive payloads.
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

    const payload = JSON.parse(payloadRaw) as {
      type?: string;
      view?: {
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

    if (payload.type === "view_submission" && payload.view?.callback_id === PEM_MODAL_CALLBACK_ID) {
      const result = await handlePemModalSubmission(payload.view);
      if (!result.ok && "errors" in result && result.errors) {
        return NextResponse.json({
          response_action: "errors",
          errors: result.errors,
        });
      }
      if (!result.ok) {
        const message = "message" in result ? result.message : "Unable to create PEM NEAT.";
        return NextResponse.json({
          response_action: "errors",
          errors: { transcript: message },
        });
      }

      // Close modal; notify via response_url from private_metadata when present.
      try {
        const meta = JSON.parse(payload.view.private_metadata || "{}") as {
          responseUrl?: string | null;
        };
        if (meta.responseUrl) {
          await postSlackResponseUrl(meta.responseUrl, {
            response_type: "ephemeral",
            text: result.message,
          }).catch(() => undefined);
        }
      } catch {
        // ignore metadata parse / notify failures — PEM was still created
      }

      return NextResponse.json({ response_action: "clear" });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/slack/interactions");
  }
}
