import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SurveyResultsClient } from "@/components/surveys/survey-results-client";
import { requireActiveUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { redactResponses } from "@/lib/surveys/analytics";
import { canEditSurvey } from "@/lib/surveys/permissions";
import { getSurvey, listSurveyResponses } from "@/lib/surveys/store";
import type { SurveyDetail, SurveyResponse } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Survey results" };

export default async function SurveyResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  const { id } = await params;
  let survey: SurveyDetail;
  let responses: SurveyResponse[];
  try {
    survey = await getSurvey(id);
    responses = redactResponses(await listSurveyResponses(id), survey.identityMode);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <AppShell user={user}>
      <SurveyResultsClient
        survey={survey}
        initialResponses={responses}
        canEdit={canEditSurvey(user, survey)}
      />
    </AppShell>
  );
}
