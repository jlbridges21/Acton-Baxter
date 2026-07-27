/**
 * Lightweight chat commands (/clear, /help) — Prompt 3.
 */

import { isGhlConfigured } from "@/lib/connectors/ghl/config";

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
    "• Ask normal questions about Acton knowledge, projects, or general help",
    clearLine,
    "• Official Acton answers cite Sources when they use approved knowledge",
  ];

  if (isGhlConfigured()) {
    lines.push(
      "",
      "GoHighLevel (live CRM):",
      "• What stage is Lori Harris in?",
      "• Who owns the Wong opportunity?",
      "• When is the next appointment?",
      "• What did this lead last say?",
      "• Show open opportunities without an owner",
      "• Move Lori to Project Findings Complete (authorized users — confirmation required)",
      "• I will not send texts or book calendars through chat yet",
    );
  }

  return lines.join("\n");
}

export const CLEAR_RESPONSE_WEB = "Conversation cleared.";
export const CLEAR_RESPONSE_SLACK = "Conversation cleared. We’re starting fresh.";
