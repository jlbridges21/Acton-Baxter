import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { duplicateSurvey } from "@/lib/surveys/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    const { id } = await params;
    const survey = await duplicateSurvey(id, user.id);
    return jsonOk({ survey }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/surveys/[id]/duplicate");
  }
}
