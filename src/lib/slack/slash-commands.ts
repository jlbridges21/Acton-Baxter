import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { baxterHelpText, CLEAR_RESPONSE_SLACK } from "@/lib/baxter-ai/commands";
import { getPublicAppBaseUrl } from "@/lib/slack/config";
import { buildSlackExternalThreadId } from "@/lib/slack/baxter-events";
import { buildBaxterSlackText, splitSlackMessage } from "@/lib/slack/format";
import type { SlackCommandAck, SlackCommandPayload } from "@/lib/slack/commands";
import { listSalespeople } from "@/lib/pem-neat/salespeople";
import { createPemNeatInputSchema } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { startPemNeatGeneration } from "@/lib/pem-neat/run-generation";
import { resolveSalespersonDisplayName } from "@/lib/pem-neat/salespeople";
import { createServiceClient } from "@/lib/supabase/admin";
import { isAppAccessRole } from "@/lib/auth/roles";

/** Slack plain_text_input max length for multiline blocks. */
export const SLACK_PEM_TRANSCRIPT_MAX_CHARS = 3000;

export const PEM_MODAL_CALLBACK_ID = "baxter_pem_create";

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
    "• `/pem` — start a Partnership Evaluation Meeting NEAT",
    "• `/property <address>` — start Property Research",
    "",
    "Examples:",
    '• Ask: "What is Carter French’s Type 1 Pain?"',
    '• GHL: "What is Rachel Redmond’s address?"',
    "• Recall: `/recall what did Jess say last in #project-management?`",
    "",
    `• Baxter: ${base}/`,
    `• PEM NEATs: ${base}/pem-neats`,
    `• Integrations: ${base}/settings/integrations`,
  ].join("\n");
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

async function slackApiPost(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    return { ok: false, error: "missing_bot_token" };
  }
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({ ok: false, error: "bad_json" }))) as {
    ok: boolean;
    error?: string;
  };
}

/**
 * Resolve Slack user → Baxter profile for PEM creation.
 * Requires a connected Slack Search link (Settings → Integrations).
 */
export async function resolveBaxterUserIdForSlackPem(input: {
  slackUserId: string;
  slackTeamId: string;
}): Promise<{ userId: string; displayName: string | null } | null> {
  const supabase = createServiceClient();

  const { data: linked } = await supabase
    .from("slack_search_connections")
    .select("baxter_user_id")
    .eq("slack_user_id", input.slackUserId)
    .eq("slack_team_id", input.slackTeamId)
    .eq("status", "connected")
    .maybeSingle();

  if (!linked?.baxter_user_id) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", linked.baxter_user_id)
    .maybeSingle();
  if (profile && isAppAccessRole(profile.role)) {
    return { userId: String(profile.id), displayName: profile.full_name ?? null };
  }
  return null;
}

export async function buildPemCreateModalView(input: {
  privateMetadata: string;
}): Promise<Record<string, unknown>> {
  const salespeople = await listSalespeople();
  const options = salespeople.slice(0, 100).map((s) => ({
    text: { type: "plain_text", text: s.displayName.slice(0, 75) },
    value: s.id,
  }));

  if (options.length === 0) {
    options.push({
      text: { type: "plain_text", text: "No Sales users available" },
      value: "none",
    });
  }

  const base = getPublicAppBaseUrl();

  return {
    type: "modal",
    callback_id: PEM_MODAL_CALLBACK_ID,
    private_metadata: input.privateMetadata,
    title: { type: "plain_text", text: "PEM NEAT" },
    submit: { type: "plain_text", text: "Generate" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Create a Partnership Evaluation Meeting NEAT. Long transcripts (>${SLACK_PEM_TRANSCRIPT_MAX_CHARS} chars): use <${base}/pem-neats/new|the web form>.`,
        },
      },
      {
        type: "input",
        block_id: "prospect_name",
        label: { type: "plain_text", text: "Prospect Name" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "Robert Vertin" },
        },
      },
      {
        type: "input",
        block_id: "salesperson",
        label: { type: "plain_text", text: "Salesperson" },
        element: {
          type: "static_select",
          action_id: "value",
          placeholder: { type: "plain_text", text: "Select salesperson" },
          options,
        },
      },
      {
        type: "input",
        block_id: "meeting_date",
        optional: true,
        label: { type: "plain_text", text: "Meeting Date (YYYY-MM-DD)" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "2026-07-29" },
        },
      },
      {
        type: "input",
        block_id: "transcript",
        label: { type: "plain_text", text: "Transcript" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: SLACK_PEM_TRANSCRIPT_MAX_CHARS,
          placeholder: {
            type: "plain_text",
            text: "Paste the full Partnership Evaluation Meeting transcript…",
          },
        },
      },
    ],
  };
}

export async function handlePemSlashCommand(
  payload: SlackCommandPayload & { trigger_id?: string },
): Promise<SlackCommandAck> {
  assertTeamAllowed(payload.team_id);

  if (!payload.user_id || !payload.team_id) {
    return {
      response_type: "ephemeral",
      text: "Unable to identify your Slack user for PEM creation.",
    };
  }

  const mapped = await resolveBaxterUserIdForSlackPem({
    slackUserId: payload.user_id,
    slackTeamId: payload.team_id,
  });
  if (!mapped) {
    const base = getPublicAppBaseUrl();
    return {
      response_type: "ephemeral",
      text: `PEM NEATs require a linked Acton Baxter account. Connect Slack Search under <${base}/settings/integrations|Settings → Integrations>, or create the PEM at <${base}/pem-neats/new|PEM NEATs>.`,
    };
  }

  if (!payload.trigger_id) {
    return {
      response_type: "ephemeral",
      text: "Slack did not provide a trigger_id to open the PEM form. Try again, or use the web form.",
    };
  }

  const privateMetadata = JSON.stringify({
    teamId: payload.team_id,
    userId: payload.user_id,
    channelId: payload.channel_id ?? null,
    responseUrl: payload.response_url ?? null,
    baxterUserId: mapped.userId,
  });

  const view = await buildPemCreateModalView({ privateMetadata });
  const opened = await slackApiPost("views.open", {
    trigger_id: payload.trigger_id,
    view,
  });

  if (!opened.ok) {
    const base = getPublicAppBaseUrl();
    return {
      response_type: "ephemeral",
      text: `Couldn't open the PEM form (${opened.error ?? "unknown"}). Enable Interactivity on the Slack app, or create at <${base}/pem-neats/new|PEM NEATs>.`,
    };
  }

  return {
    response_type: "ephemeral",
    text: "Opening PEM NEAT form…",
  };
}

type PemPrivateMeta = {
  teamId?: string;
  userId?: string;
  channelId?: string | null;
  responseUrl?: string | null;
  baxterUserId?: string;
};

export async function handlePemModalSubmission(view: {
  private_metadata?: string;
  state?: {
    values?: Record<
      string,
      Record<string, { value?: string; selected_option?: { value?: string } }>
    >;
  };
}): Promise<
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> }
  | { ok: false; message: string }
> {
  let meta: PemPrivateMeta = {};
  try {
    meta = JSON.parse(view.private_metadata || "{}") as PemPrivateMeta;
  } catch {
    return { ok: false, message: "Invalid PEM form metadata." };
  }

  if (!meta.baxterUserId || !meta.userId || !meta.teamId) {
    return { ok: false, message: "Missing Baxter identity for PEM creation." };
  }

  // Re-verify mapping still valid
  const mapped = await resolveBaxterUserIdForSlackPem({
    slackUserId: meta.userId,
    slackTeamId: meta.teamId,
  });
  if (!mapped || mapped.userId !== meta.baxterUserId) {
    return {
      ok: false,
      message: "Your Slack account is not authorized to create PEM NEATs.",
    };
  }

  const values = view.state?.values ?? {};
  const prospectName = values.prospect_name?.value?.value?.trim() ?? "";
  const salespersonUserId = values.salesperson?.value?.selected_option?.value ?? "";
  const meetingDateRaw = values.meeting_date?.value?.value?.trim() || null;
  const transcript = values.transcript?.value?.value ?? "";

  const errors: Record<string, string> = {};
  if (!prospectName) errors.prospect_name = "Prospect name is required.";
  if (!salespersonUserId || salespersonUserId === "none") {
    errors.salesperson = "Select a salesperson.";
  }
  if (transcript.length > SLACK_PEM_TRANSCRIPT_MAX_CHARS) {
    errors.transcript = `Transcript exceeds Slack’s ${SLACK_PEM_TRANSCRIPT_MAX_CHARS}-character limit. Use the web form for long transcripts.`;
  }

  const parsed = createPemNeatInputSchema.safeParse({
    prospectName,
    salespersonUserId,
    meetingDate: meetingDateRaw || null,
    transcript,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = String(issue.path[0] ?? "transcript");
      if (path === "prospectName") errors.prospect_name = issue.message;
      else if (path === "salespersonUserId") errors.salesperson = issue.message;
      else if (path === "meetingDate") errors.meeting_date = issue.message;
      else if (path === "transcript") errors.transcript = issue.message;
    }
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  const input = parsed.data!;
  const salesperson = await resolveSalespersonDisplayName(input.salespersonUserId);
  if (!salesperson) {
    return { ok: false, errors: { salesperson: "Select a valid salesperson from Sales." } };
  }

  const store = getPemNeatStore();
  const record = await store.create({
    prospectName: input.prospectName,
    salespersonUserId: input.salespersonUserId,
    salespersonDisplayName: salesperson.displayName,
    meetingDate: input.meetingDate ?? null,
    transcript: input.transcript,
    createdBy: mapped.userId,
  });

  await startPemNeatGeneration(record.id);
  const base = getPublicAppBaseUrl();
  return {
    ok: true,
    message: `PEM NEAT started for *${input.prospectName}*. Baxter is analyzing the transcript now.\n\n<${base}/pem-neats/${record.id}|Open PEM NEAT>`,
  };
}
