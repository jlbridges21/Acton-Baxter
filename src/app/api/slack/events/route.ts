import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/api";
import { verifySlackRequest } from "@/lib/slack/verify";
import {
  claimSlackEvent,
  handleBaxterSlackEvent,
  type SlackIncomingEvent,
} from "@/lib/slack/baxter-events";
import { AppError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const rawBody = await request.text();
    verifySlackRequest({
      signature: request.headers.get("x-slack-signature"),
      timestamp: request.headers.get("x-slack-request-timestamp"),
      rawBody,
    });

    const payload = JSON.parse(rawBody) as {
      type?: string;
      challenge?: string;
      team_id?: string;
      event_id?: string;
      event?: SlackIncomingEvent;
    };

    if (payload.type === "url_verification") {
      return jsonOk({ challenge: payload.challenge });
    }

    if (!env.ENABLE_SLACK_INTEGRATION) {
      return jsonOk({ ok: true, ignored: true });
    }

    const teamId = payload.team_id ?? payload.event?.team;
    if (teamId && env.SLACK_ALLOWED_TEAM_IDS) {
      const allowed = env.SLACK_ALLOWED_TEAM_IDS.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(teamId)) {
        throw new AppError("Slack team is not allowed", {
          code: "SLACK_TEAM_DENIED",
          statusCode: 403,
          expose: true,
        });
      }
    }

    if (payload.type === "event_callback" && payload.event) {
      const eventId = payload.event_id || payload.event.event_ts || payload.event.ts;
      if (eventId) {
        const claimed = await claimSlackEvent(eventId, payload.event.type, teamId);
        if (!claimed) {
          return jsonOk({ ok: true, duplicate: true });
        }
      }

      const event = payload.event;
      after(async () => {
        await handleBaxterSlackEvent(event);
      });
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/slack/events");
  }
}
