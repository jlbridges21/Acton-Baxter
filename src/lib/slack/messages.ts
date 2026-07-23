import "server-only";

import { getEnv } from "@/lib/env";

export type SlackCompletionMessageInput = {
  standardizedAddress: string;
  apn: string | null;
  jurisdiction: string | null;
  summarySnippet: string | null;
  reportId: string;
  conflictCount?: number;
};

export type SlackFailureMessageInput = {
  standardizedAddress: string;
  reportId: string;
  errorMessage?: string | null;
};

export function buildSlackCompletionMessage(input: SlackCompletionMessageInput): {
  text: string;
  blocks: unknown[];
} {
  const env = getEnv();
  const reportUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/reports/${input.reportId}`;
  const conflictNote =
    (input.conflictCount ?? 0) > 0
      ? ` ${input.conflictCount} material inconsistenc${input.conflictCount === 1 ? "y" : "ies"} should be verified.`
      : "";
  const summary =
    input.summarySnippet?.trim() ||
    "Public and licensed sources were assembled for PEM preparation.";

  const lines = [
    "Property research complete",
    "",
    input.standardizedAddress,
    input.apn ? `APN: ${input.apn}` : null,
    input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : null,
    "",
    `${summary}${conflictNote}`,
    "",
    `View full report: ${reportUrl}`,
  ].filter((line): line is string => line !== null);

  return {
    text: lines.join("\n"),
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Property research complete", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*${input.standardizedAddress}*`,
            input.apn ? `APN: ${input.apn}` : null,
            input.jurisdiction ? `Jurisdiction: ${input.jurisdiction}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${summary}${conflictNote}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View full report", emoji: false },
            url: reportUrl,
          },
        ],
      },
    ],
  };
}

export function buildSlackFailureMessage(input: SlackFailureMessageInput): {
  text: string;
  blocks: unknown[];
} {
  const env = getEnv();
  const reportUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/reports/${input.reportId}`;
  const detail =
    input.errorMessage?.trim() || "Research failed. Open the report in the app to retry.";

  const text = [
    "Property research failed",
    "",
    input.standardizedAddress,
    detail,
    "",
    `Open report: ${reportUrl}`,
  ].join("\n");

  return {
    text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Property research failed", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${input.standardizedAddress}*\n${detail}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open report", emoji: false },
            url: reportUrl,
          },
        ],
      },
    ],
  };
}
