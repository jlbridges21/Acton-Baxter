import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { assertCanEditSurvey } from "@/lib/surveys/permissions";
import { deleteSurveyResponse, getSurvey } from "@/lib/surveys/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; responseId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id, responseId } = await params;
    assertCanEditSurvey(user, await getSurvey(id));
    await deleteSurveyResponse(id, responseId);
    return jsonOk({ deleted: true });
  } catch (error) {
    return jsonError(error, "DELETE /api/surveys/[id]/responses/[responseId]");
  }
}
