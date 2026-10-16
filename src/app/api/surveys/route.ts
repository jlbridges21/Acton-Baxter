import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { createSurveySchema } from "@/lib/surveys/schemas";
import { createSurvey, listSurveys } from "@/lib/surveys/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireActiveUser();
    const surveys = await listSurveys();
    return jsonOk({ surveys });
  } catch (error) {
    return jsonError(error, "GET /api/surveys");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const input = createSurveySchema.parse(await request.json());
    const survey = await createSurvey({ ...input, actorId: user.id });
    return jsonOk({ survey }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/surveys");
  }
}
