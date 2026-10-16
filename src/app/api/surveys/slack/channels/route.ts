import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { listSlackPostableChannels, SlackClientError } from "@/lib/slack/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireActiveUser();
    const result = await listSlackPostableChannels();
    if (!result.configured) return jsonOk({ configured: false, channels: [] });
    return jsonOk({ configured: true, channels: result.channels });
  } catch (error) {
    if (error instanceof SlackClientError) {
      return jsonError(
        new AppError("Slack didn't return a channel list. Try again in a moment.", {
          code: "SLACK_CHANNELS_UNAVAILABLE",
          statusCode: 502,
          cause: error,
        }),
        "GET /api/surveys/slack/channels",
      );
    }
    return jsonError(error, "GET /api/surveys/slack/channels");
  }
}
