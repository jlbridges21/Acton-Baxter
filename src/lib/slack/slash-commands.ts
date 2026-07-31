import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { baxterHelpText, CLEAR_RESPONSE_SLACK } from "@/lib/baxter-ai/commands";
import { DEMO_CUSTOMER_NAME, DEMO_PROSPECT_NAME } from "@/lib/demo-identity";
import { getPublicAppBaseUrl } from "@/lib/slack/config";
import { buildSlackExternalThreadId } from "@/lib/slack/baxter-events";
import { buildBaxterSlackText, splitSlackMessage } from "@/lib/slack/format";
import type { SlackCommandAck, SlackCommandPayload } from "@/lib/slack/commands";

/**
 * Slack `plain_text_input` max_length is capped near 3000 characters.
 * Real PEM transcripts are often ~100k+ characters, so `/pem` hands off to the web app.
 * Kept as documentation of the platform limit (not used for input validation anymore).
 */
export const SLACK_PEM_TRANSCRIPT_MAX_CHARS = 3000;

export const PEM_NEW_PATH = "/pem-neats/new";
export const PEM_LIST_PATH = "/pem-neats";

function assertTeamAllowed(teamId: string | undefined): void {
  const env = getEnv();
  if (!env.ENABLE_SLACK_INTEGRATION) {
    throw new AppError("Slack integration is disabled", {
      code: "SLACK_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
  const allowed = new Set(
    env.SLACK_ALLOWED_TEAM_IDS.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  if (!teamId || !allowed.has(teamId)) {
    throw new AppError("This Slack workspace is not authorized", {
      code: "SLACK_TEAM_FORBIDDEN",
      statusCode: 403,
      expose: true,
    });
  }
}

function slashExternalThreadId(payload: SlackCommandPayload): string {
  const channel = payload.channel_id ?? "unknown";
  const isDm = channel.startsWith("D");
  return buildSlackExternalThreadId({
    teamId: payload.team_id ?? null,
    channelId: channel,
    userId: payload.user_id ?? null,
    threadTs: "slash",
    isDm,
  });
}

export async function handleClearSlashCommand(
  payload: SlackCommandPayload,
): Promise<SlackCommandAck> {
  assertTeamAllowed(payload.team_id);
  const result = await answerBaxterQuestion({
    question: "/clear",
    userId: null,
    channel: "slack",
    externalUserId: payload.user_id ?? null,
    externalThreadId: slashExternalThreadId(payload),
    slackTeamId: payload.team_id ?? null,
  });
  return {
    response_type: "ephemeral",
    text: result.answer || CLEAR_RESPONSE_SLACK,
  };
}

export function buildSlashHelpText(): string {
  const base = getPublicAppBaseUrl();
  const core = baxterHelpText("slack");
  return [
    core,
    "",
    "Slash commands:",
    "• `/clear` — reset this Baxter conversation",
    "• `/help` — show this help",
    "• `/recall <query>` — search Slack history (same live retrieval as chat)",
    "• `/pem` — open Baxter’s PEM NEAT tool to generate structured sales intelligence from a Partnership Evaluation Meeting transcript",
    "• `/property <address>` — start Property Research",
    "• `/new-project` — set up a new project from a GoHighLevel customer (Drive folder, charter, Slack channel)",
    "",
    "Examples:",
    `• Ask: "What is ${DEMO_PROSPECT_NAME}’s Type 1 Pain?"`,
    `• GHL: "What is ${DEMO_CUSTOMER_NAME}’s address?"`,
    "• Recall: `/recall what did Jess say last in #project-management?`",
    "",
    `• Baxter: ${base}/`,
    `• PEM NEATs: ${base}${PEM_LIST_PATH}`,
    `• Project setup: ${base}/projects/setup`,
    `• Integrations: ${base}/settings/integrations`,
  ].join("\n");
}

/** Ephemeral `/pem` response: Slack cannot hold realistic PEM transcript lengths. */
export function buildPemWebHandoffAck(): SlackCommandAck {
  const base = getPublicAppBaseUrl();
  const newUrl = `${base}${PEM_NEW_PATH}`;
  const listUrl = `${base}${PEM_LIST_PATH}`;
  const text = [
    "Generate a Partnership Evaluation Meeting NEAT in Baxter.",
    "",
    "PEM transcripts are usually too long for Slack input, so PEM generation happens in the Baxter web app.",
    "",
    `<${newUrl}|Open PEM NEAT Tool> · <${listUrl}|View Existing PEM NEATs>`,
  ].join("\n");

  return {
    response_type: "ephemeral",
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            "*Generate a Partnership Evaluation Meeting NEAT in Baxter.*",
            "",
            "PEM transcripts are usually too long for Slack input, so PEM generation happens in the Baxter web app.",
          ].join("\n"),
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open PEM NEAT Tool" },
            url: newUrl,
            action_id: "open_pem_neat_tool",
            style: "primary",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "View Existing PEM NEATs" },
            url: listUrl,
            action_id: "view_existing_pem_neats",
          },
        ],
      },
    ],
  };
}

export async function handleHelpSlashCommand(
  payload: SlackCommandPayload,
): Promise<SlackCommandAck> {
  assertTeamAllowed(payload.team_id);
  return {
    response_type: "ephemeral",
    text: buildSlashHelpText(),
  };
}

export const RECALL_USAGE =
  "Usage: `/recall <query>`\n\nExamples:\n• `/recall what did Jess say last in #project-management?`\n• `/recall latest update on the RACI matrix`\n• `/recall who mentioned the sewer issue last week`";

export async function handleRecallSlashCommand(
  payload: SlackCommandPayload,
): Promise<SlackCommandAck> {
  assertTeamAllowed(payload.team_id);
  const text = (payload.text ?? "").trim();
  if (!text) {
    return { response_type: "ephemeral", text: RECALL_USAGE };
  }

  const result = await answerBaxterQuestion({
    question: text,
    userId: null,
    channel: "slack",
    externalUserId: payload.user_id ?? null,
    externalThreadId: slashExternalThreadId(payload),
    slackTeamId: payload.team_id ?? null,
    slackRecallForced: true,
  });

  const full = buildBaxterSlackText(result);
  const chunks = splitSlackMessage(full);
  return {
    response_type: "ephemeral",
    text: chunks[0] ?? result.answer,
  };
}

/**
 * `/pem` — launcher into Baxter web PEM NEAT tool.
 * Does not open a Slack modal (transcripts exceed Slack plain_text_input limits).
 * Does not require Slack Search OAuth or a Baxter user mapping.
 */
export async function handlePemSlashCommand(
  payload: SlackCommandPayload,
): Promise<SlackCommandAck> {
  assertTeamAllowed(payload.team_id);
  return buildPemWebHandoffAck();
}
