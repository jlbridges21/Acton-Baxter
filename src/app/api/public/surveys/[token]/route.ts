import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { getSurveyByToken } from "@/lib/surveys/store";
import { toPublicSurvey } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const survey = await getSurveyByToken(token);
    const publicSurvey = survey ? toPublicSurvey(survey) : null;
    if (!publicSurvey || publicSurvey.questions.length === 0) {
      throw new NotFoundError("This survey isn't available.");
    }
    return jsonOk({ survey: publicSurvey }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error, "GET /api/public/surveys/[token]");
  }
}
