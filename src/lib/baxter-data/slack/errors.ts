/** Stable Slack search error codes (never include secrets or message bodies). */
export const SLACK_SEARCH_ERROR_CODES = {
  DISABLED: "BAXTER_SLACK_SEARCH_DISABLED",
  AUTH_REQUIRED: "BAXTER_SLACK_SEARCH_AUTH_REQUIRED",
  SCOPE_MISSING: "BAXTER_SLACK_SEARCH_SCOPE_MISSING",
  USER_NOT_LINKED: "BAXTER_SLACK_USER_NOT_LINKED",
  CHANNEL_NOT_FOUND: "BAXTER_SLACK_CHANNEL_NOT_FOUND",
  PERSON_AMBIGUOUS: "BAXTER_SLACK_PERSON_AMBIGUOUS",
  CHANNEL_AMBIGUOUS: "BAXTER_SLACK_CHANNEL_AMBIGUOUS",
  PERSON_NOT_FOUND: "BAXTER_SLACK_PERSON_NOT_FOUND",
  RATE_LIMITED: "BAXTER_SLACK_RATE_LIMITED",
  SEARCH_UNAVAILABLE: "BAXTER_SLACK_SEARCH_UNAVAILABLE",
  PERMISSION_DENIED: "BAXTER_SLACK_PERMISSION_DENIED",
  CONTRACT_ERROR: "BAXTER_SLACK_SEARCH_CONTRACT_ERROR",
  MISCONFIGURED: "BAXTER_SLACK_SEARCH_MISCONFIGURED",
} as const;

export type SlackSearchErrorCode =
  (typeof SLACK_SEARCH_ERROR_CODES)[keyof typeof SLACK_SEARCH_ERROR_CODES];

export function mapSlackSearchApiError(
  slackError: string | undefined | null,
): SlackSearchErrorCode {
  switch (slackError) {
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
    case "not_authed":
    case "missing_action_token":
      return SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED;
    case "missing_scope":
    case "not_allowed_token_type":
      return SLACK_SEARCH_ERROR_CODES.SCOPE_MISSING;
    case "ratelimited":
    case "rate_limited":
    case "accesslimited":
      return SLACK_SEARCH_ERROR_CODES.RATE_LIMITED;
    case "access_denied":
    case "restricted_action":
      return SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED;
    case "assistant_search_context_disabled":
    case "team_access_not_granted":
    case "method_not_supported_for_channel_type":
      return SLACK_SEARCH_ERROR_CODES.SEARCH_UNAVAILABLE;
    case "channel_not_found":
    case "context_channel_not_found":
      return SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND;
    default:
      return SLACK_SEARCH_ERROR_CODES.CONTRACT_ERROR;
  }
}

export function employeeFacingSlackSearchError(code: string): string {
  switch (code) {
    case SLACK_SEARCH_ERROR_CODES.DISABLED:
      return "Slack search is not enabled for Baxter yet.";
    case SLACK_SEARCH_ERROR_CODES.AUTH_REQUIRED:
    case SLACK_SEARCH_ERROR_CODES.USER_NOT_LINKED:
      return "Slack search is unavailable until your Slack account is linked.";
    case SLACK_SEARCH_ERROR_CODES.SCOPE_MISSING:
      return "Baxter needs additional Slack permissions to search. Ask an admin to reconnect Slack search.";
    case SLACK_SEARCH_ERROR_CODES.PERSON_AMBIGUOUS:
      return "That name matches more than one Slack user. Please clarify which person you mean.";
    case SLACK_SEARCH_ERROR_CODES.CHANNEL_AMBIGUOUS:
      return "That channel name matches more than one Slack channel. Please clarify which channel you mean.";
    case SLACK_SEARCH_ERROR_CODES.CHANNEL_NOT_FOUND:
      return "I couldn't find that Slack channel.";
    case SLACK_SEARCH_ERROR_CODES.PERSON_NOT_FOUND:
      return "I couldn't find an active Slack user matching that name.";
    case SLACK_SEARCH_ERROR_CODES.RATE_LIMITED:
      return "Slack search is temporarily rate-limited. Please try again in a minute.";
    case SLACK_SEARCH_ERROR_CODES.PERMISSION_DENIED:
      return "Baxter can’t search that Slack content with your current permissions.";
    default:
      return `Baxter couldn’t complete Slack search right now. Reference: ${code}`;
  }
}
