import { getOptionalUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { surveySubmissionSchema, validateSurveySubmission } from "@/lib/surveys/schemas";
import { getSurveyByToken, insertSurveyResponse } from "@/lib/surveys/store";
import { toPublicSurvey } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

/** 100 questions × 5,000-char answers is ~500KB; anything larger is not a real submission. */
const MAX_BODY_BYTES = 600_000;
const RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

type Params = { params: Promise<{ token: string }> };

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { token } = await params;

    const limit = checkRateLimit(`survey-submit:${clientIp(request)}`, RATE_LIMIT);
    if (!limit.allowed) {
      throw new RateLimitError(
        "Too many submissions from this network. Try again in a few minutes.",
      );
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
      throw new AppError("That response is too large to submit.", {
        code: "PAYLOAD_TOO_LARGE",
        statusCode: 413,
      });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw new AppError("That response is too large to submit.", {
        code: "PAYLOAD_TOO_LARGE",
        statusCode: 413,
      });
    }

    const survey = await getSurveyByToken(token);
    const publicSurvey = survey ? toPublicSurvey(survey) : null;
    if (!survey || !publicSurvey || publicSurvey.questions.length === 0) {
      throw new NotFoundError("This survey isn't available.");
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ValidationError("Invalid request.");
    }
    const submission = surveySubmissionSchema.parse(body);
    if (submission.website.trim()) {
      throw new ValidationError("Your response couldn't be recorded.");
    }

    const result = validateSurveySubmission(publicSurvey, submission);
    if (!result.ok) {
      return jsonError(
        new ValidationError(result.message),
        "POST /api/public/surveys/[token]/responses",
      );
    }

    let respondentUserId: string | null = null;
    let respondentName = result.respondentName;
    if (survey.identityMode !== "anonymous") {
      const user = await getOptionalUser();
      if (user) {
        respondentUserId = user.id;
        respondentName = respondentName ?? (user.profile.full_name || null);
      }
    }

    const { id } = await insertSurveyResponse({
      surveyId: survey.id,
      respondentUserId,
      respondentName: survey.identityMode === "anonymous" ? null : respondentName,
      respondentEmail: survey.identityMode === "anonymous" ? null : result.respondentEmail,
      answers: result.answers,
    });
    return jsonOk({ recorded: true, responseId: id }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/public/surveys/[token]/responses");
  }
}
