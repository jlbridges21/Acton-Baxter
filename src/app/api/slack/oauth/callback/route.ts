import { jsonOk } from "@/lib/api";

/**
 * OAuth callback stub for future multi-workspace installs.
 * For v1, a manually configured bot token (SLACK_BOT_TOKEN) is sufficient.
 */
export async function GET() {
  return jsonOk({
    ok: true,
    message:
      "Slack OAuth is optional in v1. Configure SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET manually for the internal workspace.",
  });
}
