import { requireActiveUser } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import { redactResponses } from "@/lib/surveys/analytics";
import { buildSurveyXlsx } from "@/lib/surveys/export-xlsx";
import { getSurvey, listSurveyResponses } from "@/lib/surveys/store";
import { safeSurveyFilename } from "@/lib/surveys/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id } = await params;
    const survey = await getSurvey(id);
    const responses = redactResponses(await listSurveyResponses(id), survey.identityMode);
    const bytes = buildSurveyXlsx(survey, responses);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeSurveyFilename(survey.title)}-survey-results.xlsx"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/surveys/[id]/export-xlsx");
  }
}
