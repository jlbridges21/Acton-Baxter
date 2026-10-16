import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { postSlackMessage, SlackClientError } from "@/lib/slack/client";
import { getPublicAppBaseUrl } from "@/lib/slack/config";
import { SLACK_ERROR_CODES } from "@/lib/slack/errors";
import { shareSurveyToSlackSchema } from "@/lib/surveys/schemas";
import { buildSurveySlackText } from "@/lib/surveys/slack";
import { getSurvey } from "@/lib/surveys/store";
import { activeQuestions, publicSurveyUrl } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function slackFailure(error: SlackClientError): AppError {
  if (error.baxterCode === SLACK_ERROR_CODES.MISCONFIGURED) {
    return new AppError("Slack isn't set up for Baxter yet. Ask an admin to connect it.", {
      code: "SLACK_NOT_CONFIGURED",
      statusCode: 503,
      cause: error,
    });
  }
  if (error.slackError === "not_in_channel" || error.slackError === "channel_not_found") {
    return new AppError(
      "Baxter isn't in that channel. Invite the Baxter app to it and try again.",
      {
        code: "SLACK_NOT_IN_CHANNEL",
        statusCode: 400,
        cause: error,
      },
    );
  }
  return new AppError("Slack didn't accept the message. Try again in a moment.", {
    code: "SLACK_POST_FAILED",
    statusCode: 502,
    cause: error,
  });
}

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    const input = shareSurveyToSlackSchema.parse(await request.json());
    const survey = await getSurvey(id);
    if (activeQuestions(survey.questions).length === 0) {
      throw new ValidationError("Add at least one question before sharing this survey.");
    }
    const text = buildSurveySlackText({
      title: survey.title,
      description: survey.description,
      url: publicSurveyUrl(getPublicAppBaseUrl(), survey.publicToken),
      message: input.message,
      sharedBy: user.profile.full_name || null,
    });
    try {
      await postSlackMessage({ channel: input.channelId, text });
    } catch (error) {
      if (error instanceof SlackClientError) throw slackFailure(error);
      throw error;
    }
    return jsonOk({ shared: true });
  } catch (error) {
    return jsonError(error, "POST /api/surveys/[id]/share-slack");
  }
}
