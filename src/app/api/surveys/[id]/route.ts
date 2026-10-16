import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { assertCanEditSurvey, canEditSurvey } from "@/lib/surveys/permissions";
import { saveSurveySchema } from "@/lib/surveys/schemas";
import { getSurvey, saveSurvey, softDeleteSurvey } from "@/lib/surveys/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    const survey = await getSurvey(id);
    return jsonOk({ survey, canEdit: canEditSurvey(user, survey) });
  } catch (error) {
    return jsonError(error, "GET /api/surveys/[id]");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    assertCanEditSurvey(user, await getSurvey(id));
    const input = saveSurveySchema.parse(await request.json());
    const survey = await saveSurvey(id, input);
    return jsonOk({ survey });
  } catch (error) {
    return jsonError(error, "PUT /api/surveys/[id]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    assertCanEditSurvey(user, await getSurvey(id));
    await softDeleteSurvey(id);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/surveys/[id]");
  }
}
