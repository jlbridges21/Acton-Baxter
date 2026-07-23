import "server-only";

import { getEnv } from "@/lib/env";
import { AppError, ValidationError } from "@/lib/errors";
import { resolveAddressInput } from "@/lib/address/resolve";
import { createPropertyReportFromAddress } from "@/lib/research/create-property-report";
import { enqueueJob } from "@/lib/jobs/queue";

export type SlackCommandPayload = {
  team_id?: string;
  user_id?: string;
  channel_id?: string;
  text?: string;
  command?: string;
  response_url?: string;
};

export type SlackCommandAck = {
  response_type: "ephemeral";
  text: string;
};

function parseAllowedTeamIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export async function handlePropertySlashCommand(
  payload: SlackCommandPayload,
): Promise<SlackCommandAck> {
  const env = getEnv();
  if (!env.ENABLE_SLACK_INTEGRATION) {
    throw new AppError("Slack integration is disabled", {
      code: "SLACK_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }

  const allowedTeams = parseAllowedTeamIds(env.SLACK_ALLOWED_TEAM_IDS);
  if (!payload.team_id || !allowedTeams.has(payload.team_id)) {
    throw new AppError("This Slack workspace is not authorized", {
      code: "SLACK_TEAM_FORBIDDEN",
      statusCode: 403,
      expose: true,
    });
  }

  const text = (payload.text ?? "").trim();
  if (!text) {
    throw new ValidationError(
      `Usage: ${env.SLACK_COMMAND_NAME || "/property"} <California property address>`,
    );
  }

  const resolved = await resolveAddressInput(text);
  if (resolved.status === "rejected") {
    throw new ValidationError(resolved.message);
  }
  if (resolved.status === "ambiguous") {
    const options = resolved.candidates
      .slice(0, 5)
      .map((candidate, index) => `${index + 1}. ${candidate.formattedAddress}`)
      .join("\n");
    return {
      response_type: "ephemeral",
      text: `${resolved.message}\n\n${options}\n\nResubmit with the exact formatted address.`,
    };
  }

  const reportUserId = env.SLACK_REPORT_USER_ID;
  if (!reportUserId) {
    throw new AppError("SLACK_REPORT_USER_ID is not configured", {
      code: "SLACK_USER_MISSING",
      statusCode: 500,
      expose: false,
    });
  }

  const created = await createPropertyReportFromAddress(resolved.address, reportUserId);

  await enqueueJob({
    reportId: created.reportId,
    jobType: "property_research",
    metadata: {
      source: "slack",
      slackTeamId: payload.team_id,
      slackUserId: payload.user_id ?? null,
      slackChannelId: payload.channel_id ?? null,
      responseUrl: payload.response_url ?? null,
    },
  });

  await enqueueJob({
    reportId: created.reportId,
    jobType: "slack_completion_notification",
    availableAt: new Date(Date.now() + 5_000).toISOString(),
    metadata: {
      source: "slack",
      slackTeamId: payload.team_id,
      slackUserId: payload.user_id ?? null,
      slackChannelId: payload.channel_id ?? null,
      responseUrl: payload.response_url ?? null,
    },
  });

  return {
    response_type: "ephemeral",
    text: `Property research queued for ${resolved.address.formattedAddress}. You will receive a follow-up when the report is ready.`,
  };
}

export function parseSlackCommandBody(rawBody: string): SlackCommandPayload {
  const params = new URLSearchParams(rawBody);
  return {
    team_id: params.get("team_id") ?? undefined,
    user_id: params.get("user_id") ?? undefined,
    channel_id: params.get("channel_id") ?? undefined,
    text: params.get("text") ?? undefined,
    command: params.get("command") ?? undefined,
    response_url: params.get("response_url") ?? undefined,
  };
}
