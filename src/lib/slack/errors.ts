/** Stable Slack-facing error codes (never include secrets). */
export const SLACK_ERROR_CODES = {
  SIGNATURE_INVALID: "BAXTER_SLACK_SIGNATURE_INVALID",
  TIMESTAMP_INVALID: "BAXTER_SLACK_TIMESTAMP_INVALID",
  TEAM_NOT_ALLOWED: "BAXTER_SLACK_TEAM_NOT_ALLOWED",
  EVENT_DUPLICATE: "BAXTER_SLACK_EVENT_DUPLICATE",
  EVENT_UNSUPPORTED: "BAXTER_SLACK_EVENT_UNSUPPORTED",
  JOB_FAILED: "BAXTER_SLACK_JOB_FAILED",
  POST_FAILED: "BAXTER_SLACK_POST_FAILED",
  AUTH_FAILED: "BAXTER_SLACK_AUTH_FAILED",
  RATE_LIMITED: "BAXTER_SLACK_RATE_LIMITED",
  CHANNEL_NOT_FOUND: "BAXTER_SLACK_CHANNEL_NOT_FOUND",
  NOT_IN_CHANNEL: "BAXTER_SLACK_NOT_IN_CHANNEL",
  MISSING_SCOPE: "BAXTER_SLACK_MISSING_SCOPE",
  CHANNEL_NOT_ALLOWED: "BAXTER_SLACK_CHANNEL_NOT_ALLOWED",
  USER_NOT_ALLOWED: "BAXTER_SLACK_USER_NOT_ALLOWED",
  DMS_DISABLED: "BAXTER_SLACK_DMS_DISABLED",
  MENTIONS_DISABLED: "BAXTER_SLACK_MENTIONS_DISABLED",
  DISABLED: "BAXTER_SLACK_DISABLED",
  MISCONFIGURED: "BAXTER_SLACK_MISCONFIGURED",
} as const;

export type SlackErrorCode = (typeof SLACK_ERROR_CODES)[keyof typeof SLACK_ERROR_CODES];

export function mapSlackApiErrorToCode(slackError: string | undefined | null): SlackErrorCode {
  switch (slackError) {
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
    case "not_authed":
      return SLACK_ERROR_CODES.AUTH_FAILED;
    case "missing_scope":
      return SLACK_ERROR_CODES.MISSING_SCOPE;
    case "channel_not_found":
      return SLACK_ERROR_CODES.CHANNEL_NOT_FOUND;
    case "not_in_channel":
      return SLACK_ERROR_CODES.NOT_IN_CHANNEL;
    case "ratelimited":
      return SLACK_ERROR_CODES.RATE_LIMITED;
    default:
      return SLACK_ERROR_CODES.POST_FAILED;
  }
}

export function employeeFacingSlackError(code: string): string {
  return `Baxter couldn’t complete that response right now. Please try again in a few minutes. Reference: ${code}`;
}
