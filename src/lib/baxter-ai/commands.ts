/**
 * Lightweight chat commands (/clear, /help) — Prompt 3.
 */

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { DEMO_CUSTOMER_NAME } from "@/lib/demo-identity";

export type ChatCommand = { type: "clear" } | { type: "help" } | { type: "none"; text: string };

export function parseChatCommand(raw: string): ChatCommand {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase().replace(/^\/+/, "/");
  if (normalized === "/clear" || normalized === "clear") {
    // Accept bare "clear" only as exact message to avoid hijacking normal English
    if (trimmed.toLowerCase() === "clear") {
      return { type: "none", text: raw };
    }
    return { type: "clear" };
  }
  if (normalized === "/help" || normalized === "help") {
    if (trimmed.toLowerCase() === "help" && !trimmed.startsWith("/")) {
      return { type: "none", text: raw };
    }
    return { type: "help" };
  }
  return { type: "none", text: raw };
}

export function baxterHelpText(channel: "web" | "slack"): string {
  const clearLine =
    channel === "slack"
      ? "• `/clear` — start a fresh conversation in this DM or thread"
      : "• `/clear` or **New chat** — start a fresh conversation";
  const lines = [
    "Here’s how to work with Baxter:",
    "• Ask normal questions about Acton knowledge, PEM NEATs, projects, or general help",
    "• Ask about saved PEMs (for example: “What was Alex’s Type 1 pain?”)",
    clearLine,
    "• Official Acton answers cite Sources when they use approved knowledge or PEM NEATs",
    "",
    "Slack Search (live — only conversations your Slack account can access):",
    "• What is the latest on the RACI matrix?",
    "• What happened in #sales yesterday?",
    "• When did we decide to change the PEM process?",
    channel === "web"
      ? "• Connect under Settings → Integrations if private channels/DMs are needed"
      : "• Connect Slack Search in Baxter Settings → Integrations for private channels/DMs",
  ];

  if (isGhlConfigured()) {
    lines.push(
      "",
      "GoHighLevel (live CRM):",
      `• What stage is ${DEMO_CUSTOMER_NAME} in?`,
      "• Who owns the Doe opportunity?",
      "• What did this lead last say?",
      `• Move ${DEMO_CUSTOMER_NAME} to Project Findings Complete (authorized users — confirmation required)`,
    );
  }

  return lines.join("\n");
}

export const CLEAR_RESPONSE_WEB = "Conversation cleared.";
export const CLEAR_RESPONSE_SLACK = "Conversation cleared. We’re starting fresh.";
