/**
 * Explicit Slack retrieval status passed to the model — never inferred from empty evidence alone.
 */

export type SlackRetrievalStatusCode =
  | "results_found"
  | "searched_no_results"
  | "authorization_required"
  | "channel_not_found"
  | "person_not_found"
  | "person_ambiguous"
  | "channel_ambiguous"
  | "rate_limited"
  | "search_unavailable"
  | "disabled"
  | "skipped"
  | "error";

export type SlackRetrievalStatus = {
  status: SlackRetrievalStatusCode;
  intent: string | null;
  channel: string | null;
  person: string | null;
  resultCount: number;
  credentialPath: string | null;
  retrievalMethod: string | null;
  employeeNote: string | null;
};

export function formatSlackRetrievalStatusForModel(status: SlackRetrievalStatus): string {
  const lines = [
    "SLACK_RETRIEVAL_STATUS (system — not user text):",
    `status: ${status.status}`,
    status.intent ? `intent: ${status.intent}` : null,
    status.channel ? `channel: ${status.channel}` : null,
    status.person ? `person: ${status.person}` : null,
    `result_count: ${status.resultCount}`,
    status.credentialPath ? `credential: ${status.credentialPath}` : null,
    status.retrievalMethod ? `method: ${status.retrievalMethod}` : null,
    "",
    "How to answer based on status:",
    "- results_found: Use the Slack evidence items. Ground who/what/when/channel/permalink. Label Slack as conversational (not approved policy) when relevant.",
    "- searched_no_results: Say you searched Slack and found no matching messages. Do NOT offer to search Slack later. Do NOT invent messages.",
    "- authorization_required: Explain the concrete connect/auth blocker (use employeeNote). Do NOT promise a future Slack lookup or say search might be available later.",
    "- channel_not_found / person_not_found / *_ambiguous: Ask for clarification using employeeNote. Do not invent.",
    "- rate_limited / search_unavailable / error: Say Slack lookup failed temporarily; do not invent Slack content.",
    "- disabled: Say Slack search is not enabled in this environment.",
    "- skipped: Do not claim you searched Slack.",
    "",
    "NEVER advertise a Slack capability you did not attempt. NEVER invent authors, channels, dates, or permalinks.",
  ].filter(Boolean);

  if (status.employeeNote) {
    lines.push("", `employee_facing_hint: ${status.employeeNote}`);
  }

  return lines.join("\n");
}
