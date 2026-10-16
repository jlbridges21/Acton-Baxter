import type { Metadata } from "next";
import { SurveyRespondentForm } from "@/components/surveys/survey-respondent-form";
import { getOptionalUser } from "@/lib/auth/session";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { getSurveyByToken } from "@/lib/surveys/store";
import { toPublicSurvey, type PublicSurvey } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

async function loadPublicSurvey(token: string): Promise<PublicSurvey | null> {
  const survey = await getSurveyByToken(token);
  if (!survey) return null;
  const publicSurvey = toPublicSurvey(survey);
  return publicSurvey.questions.length > 0 ? publicSurvey : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const survey = await loadPublicSurvey(token);
  return {
    title: survey?.title ?? "Survey",
    description: survey?.description ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicSurveyPage({ params }: Params) {
  const { token } = await params;
  const [survey, branding] = await Promise.all([loadPublicSurvey(token), getBrandingWithLogo()]);
  const companyName = branding.companyName || "Acton ADU";

  let prefill: { name: string; email: string } | null = null;
  if (survey && survey.identityMode !== "anonymous") {
    const user = await getOptionalUser();
    if (user) prefill = { name: user.profile.full_name ?? "", email: user.email ?? "" };
  }

  return (
    <main className="min-h-screen bg-[var(--acton-gray-50)] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-3">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.logoAltText || companyName}
              className="h-10 w-auto object-contain"
            />
          ) : null}
          <span className="text-sm font-semibold text-[var(--acton-navy)]">{companyName}</span>
        </div>
        <div className="rounded-xl border border-[var(--acton-border)] bg-white p-5 shadow-sm sm:p-8">
          {survey ? (
            <>
              <div className="mb-6 border-b border-[var(--acton-border)] pb-5">
                <div className="mb-3 h-1 w-16 rounded bg-[var(--acton-yellow)]" />
                <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">{survey.title}</h1>
                {survey.description ? (
                  <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--acton-muted)]">
                    {survey.description}
                  </p>
                ) : null}
              </div>
              <SurveyRespondentForm survey={survey} prefill={prefill} />
            </>
          ) : (
            <div className="py-10 text-center" data-testid="survey-unavailable">
              <h1 className="text-xl font-semibold text-[var(--acton-navy)]">
                This survey isn&apos;t available
              </h1>
              <p className="mt-2 text-sm text-[var(--acton-muted)]">
                The link may be wrong, or the survey was removed. Check with whoever sent it to you.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
