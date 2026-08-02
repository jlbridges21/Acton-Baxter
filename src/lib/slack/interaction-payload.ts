/**
 * Parse Slack interactivity request bodies.
 * Slack sends `application/x-www-form-urlencoded` with a single `payload` field
 * containing a JSON string — never a raw JSON body.
 */

export type SlackInteractionPayload = {
  type?: string;
  user?: { id?: string };
  team?: { id?: string };
  trigger_id?: string;
  channel?: { id?: string };
  actions?: Array<{
    action_id?: string;
    block_id?: string;
    value?: string;
    type?: string;
  }>;
  view?: {
    id?: string;
    hash?: string;
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string; selected_option?: { value?: string } }>
      >;
    };
  };
};

/**
 * Extract and JSON-parse the `payload` form field from a Slack interactivity raw body.
 * Returns null when the body is missing/malformed (caller should ack harmlessly).
 */
export function parseSlackInteractionPayload(rawBody: string): SlackInteractionPayload | null {
  if (!rawBody?.trim()) return null;
  try {
    const params = new URLSearchParams(rawBody);
    const payloadRaw = params.get("payload");
    if (!payloadRaw) return null;
    return JSON.parse(payloadRaw) as SlackInteractionPayload;
  } catch {
    return null;
  }
}
