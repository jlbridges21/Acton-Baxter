import "server-only";

import { escapeSlackMrkdwn } from "@/lib/slack/format";

export function buildSurveySlackText(input: {
  title: string;
  description: string | null;
  url: string;
  message: string;
  sharedBy: string | null;
}): string {
  const lines: string[] = [];
  if (input.message.trim()) lines.push(escapeSlackMrkdwn(input.message.trim()), "");
  lines.push(`:clipboard: *${escapeSlackMrkdwn(input.title)}*`);
  if (input.description) lines.push(escapeSlackMrkdwn(input.description));
  lines.push(`<${input.url}|Take the survey>`);
  if (input.sharedBy) lines.push(`_Shared by ${escapeSlackMrkdwn(input.sharedBy)}_`);
  return lines.join("\n");
}
