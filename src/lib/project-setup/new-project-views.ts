/**
 * Slack Block Kit views for /new-project modal flow.
 * Pure builders — no I/O — so unit tests can assert structure without Slack.
 */

import type { ProjectSetupSearchHit } from "./service";

export const NEW_PROJECT_CALLBACK_SEARCH = "project_setup_search";
export const NEW_PROJECT_CALLBACK_PICK = "project_setup_pick";
export const NEW_PROJECT_CALLBACK_CONFIRM = "project_setup_confirm";

export type NewProjectModalMeta = {
  slackUserId: string;
  slackTeamId: string;
  query?: string;
  contactId?: string;
  hits?: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  }>;
};

export function encodeModalMeta(meta: NewProjectModalMeta): string {
  return JSON.stringify(meta).slice(0, 3000);
}

export function decodeModalMeta(raw: string | undefined | null): NewProjectModalMeta | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as NewProjectModalMeta;
    if (!parsed.slackUserId || !parsed.slackTeamId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildSearchModal(input: {
  prefill?: string;
  meta: NewProjectModalMeta;
  errorText?: string;
}): Record<string, unknown> {
  const blocks: unknown[] = [];
  if (input.errorText) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${input.errorText}*` },
    });
  }
  blocks.push({
    type: "input",
    block_id: "customer_name",
    label: { type: "plain_text", text: "Customer name" },
    element: {
      type: "plain_text_input",
      action_id: "customer_name_input",
      placeholder: { type: "plain_text", text: "e.g. Lisa Wright" },
      ...(input.prefill?.trim() ? { initial_value: input.prefill.trim().slice(0, 100) } : {}),
    },
  });

  return {
    type: "modal",
    callback_id: NEW_PROJECT_CALLBACK_SEARCH,
    private_metadata: encodeModalMeta(input.meta),
    title: { type: "plain_text", text: "New project" },
    submit: { type: "plain_text", text: "Search" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

export function buildPickModal(input: {
  meta: NewProjectModalMeta;
  hits: ProjectSetupSearchHit[];
}): Record<string, unknown> {
  const options = input.hits.slice(0, 5).map((hit) => {
    const detail = [hit.email, hit.phone, hit.address].filter(Boolean).join(" · ");
    const label = detail ? `${hit.name} — ${detail}` : hit.name;
    return {
      text: { type: "plain_text", text: label.slice(0, 75) },
      value: hit.id,
    };
  });

  const meta: NewProjectModalMeta = {
    ...input.meta,
    hits: input.hits.slice(0, 5).map((h) => ({
      id: h.id,
      name: h.name,
      email: h.email,
      phone: h.phone,
      address: h.address,
    })),
  };

  return {
    type: "modal",
    callback_id: NEW_PROJECT_CALLBACK_PICK,
    private_metadata: encodeModalMeta(meta),
    title: { type: "plain_text", text: "Pick customer" },
    submit: { type: "plain_text", text: "Continue" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Found *${input.hits.length}* match${input.hits.length === 1 ? "" : "es"}. Select one to continue.`,
        },
      },
      {
        type: "input",
        block_id: "contact_pick",
        label: { type: "plain_text", text: "Customer" },
        element: {
          type: "radio_buttons",
          action_id: "contact_pick_input",
          options,
        },
      },
    ],
  };
}

export function buildConfirmModal(input: {
  meta: NewProjectModalMeta;
  contactName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  salesRep: string;
  projectNumber: string;
  folderName: string;
  charterName: string;
  slackChannelName: string;
  inviteLabel: string;
  fpPaidDate: string;
}): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: NEW_PROJECT_CALLBACK_CONFIRM,
    private_metadata: encodeModalMeta(input.meta),
    title: { type: "plain_text", text: "Confirm setup" },
    submit: { type: "plain_text", text: "Start setup" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*${input.contactName}*`,
            input.email ? `Email: ${input.email}` : null,
            input.phone ? `Phone: ${input.phone}` : null,
            input.address ? `Address: ${input.address}` : null,
            `Sales rep: ${input.salesRep || "—"}`,
            `FP paid date: ${input.fpPaidDate}`,
            `Project number: *${input.projectNumber}*`,
            `Folder: ${input.folderName}`,
            `Charter: ${input.charterName}`,
            `Slack channel: #${input.slackChannelName}`,
            input.inviteLabel,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This starts a *live* setup (Master Log, Drive folder, charter, Slack). You will get a DM when it finishes.",
          },
        ],
      },
    ],
  };
}

export function buildLoadingModal(input: {
  meta: NewProjectModalMeta;
  message: string;
}): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: NEW_PROJECT_CALLBACK_SEARCH,
    private_metadata: encodeModalMeta(input.meta),
    title: { type: "plain_text", text: "New project" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: input.message },
      },
    ],
  };
}
