import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { redactResponses } from "@/lib/surveys/analytics";
import { getSurvey, listSurveyResponses } from "@/lib/surveys/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id } = await params;
    const survey = await getSurvey(id);
    const responses = redactResponses(await listSurveyResponses(id), survey.identityMode);
    return jsonOk({ responses });
  } catch (error) {
    return jsonError(error, "GET /api/surveys/[id]/responses");
  }
}
