import { after } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { processJob } from "@/lib/jobs/process";
import { claimJobById } from "@/lib/jobs/queue";
import { acceptBaxterSlackEvent, type SlackIncomingEvent } from "@/lib/slack/baxter-events";
import { getSlackRuntimeConfig, isSlackTeamAllowed } from "@/lib/slack/config";
import { SLACK_ERROR_CODES } from "@/lib/slack/errors";
import { verifySlackRequest, SlackSignatureError } from "@/lib/slack/verify";

export async function POST(request: Request) {
  try {
    const config = getSlackRuntimeConfig();
    const rawBody = await request.text();

    try {
      verifySlackRequest({
        signature: request.headers.get("x-slack-signature"),
        timestamp: request.headers.get("x-slack-request-timestamp"),
        rawBody,
      });
    } catch (error) {
      if (error instanceof SlackSignatureError) {
        const message = error.message.toLowerCase();
        const code = message.includes("timestamp")
          ? SLACK_ERROR_CODES.TIMESTAMP_INVALID
          : SLACK_ERROR_CODES.SIGNATURE_INVALID;
        throw new AppError(error.message, {
          code,
          statusCode: 401,
          expose: true,
        });
      }
      throw error;
    }

    const payload = JSON.parse(rawBody) as {
      type?: string;
      challenge?: string;
      team_id?: string;
      event_id?: string;
      event?: SlackIncomingEvent;
    };

    // URL verification must succeed even when the integration is disabled,
    // as long as the signing secret is valid (already verified above).
    if (payload.type === "url_verification") {
      return jsonOk({ challenge: payload.challenge });
    }

    if (!config.enabled) {
      return jsonOk({ ok: true, ignored: true, code: SLACK_ERROR_CODES.DISABLED });
    }

    if (!config.readyForEvents) {
      return jsonOk({
        ok: true,
        ignored: true,
        code: SLACK_ERROR_CODES.MISCONFIGURED,
        missing: config.missingRequired,
      });
    }

    const teamId = payload.team_id ?? payload.event?.team ?? null;
    if (!isSlackTeamAllowed(teamId)) {
      throw new AppError("Slack team is not allowed", {
        code: SLACK_ERROR_CODES.TEAM_NOT_ALLOWED,
        statusCode: 403,
        expose: true,
      });
    }

    if (payload.type === "event_callback" && payload.event) {
      const eventId = payload.event_id || payload.event.event_ts || payload.event.ts || null;
      if (!eventId) {
        return jsonOk({ ok: true, ignored: true, code: SLACK_ERROR_CODES.EVENT_UNSUPPORTED });
      }

      // Check if this is a reaction event for a monitoring finding
      const event = payload.event;
      const isReactionEvent = event.type?.startsWith("reaction_");

      if (isReactionEvent) {
        const { findBySlackMessage } = await import("@/lib/monitoring");
        const { enqueueJob } = await import("@/lib/jobs/queue");

        const item = (event as { item?: { channel?: string; ts?: string } }).item;
        const channel = item?.channel;
        const ts = item?.ts;
        const reaction = (event as { reaction?: string }).reaction;
        const user = event.user;

        if (channel && ts) {
          const finding = await findBySlackMessage(channel, ts);
          if (finding) {
            await enqueueJob({
              reportId: null,
              jobType: "slack_monitoring_reaction",
              metadata: { channel, ts, reaction, user },
            });
            return jsonOk({ ok: true });
          }
        }

        return jsonOk({ ok: true, ignored: true, code: SLACK_ERROR_CODES.EVENT_UNSUPPORTED });
      }

      const accepted = await acceptBaxterSlackEvent({
        eventId,
        teamId,
        event: payload.event,
      });

      if (accepted.duplicate) {
        return jsonOk({
          ok: true,
          duplicate: true,
          code: SLACK_ERROR_CODES.EVENT_DUPLICATE,
        });
      }

      const jobId = accepted.jobId;
      if (jobId) {
        after(async () => {
          const job = await claimJobById(jobId);
          if (job) await processJob(job);
        });
      }
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/slack/events");
  }
}
