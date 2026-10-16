import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SurveyEditorClient } from "@/components/surveys/survey-editor-client";
import { requireActiveUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { canEditSurvey } from "@/lib/surveys/permissions";
import { getSurvey } from "@/lib/surveys/store";
import type { SurveyDetail } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit survey" };

export default async function EditSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  const { id } = await params;
  let survey: SurveyDetail;
  try {
    survey = await getSurvey(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (!canEditSurvey(user, survey)) redirect(`/surveys/${id}/responses`);

  return (
    <AppShell user={user}>
      <SurveyEditorClient initialSurvey={survey} />
    </AppShell>
  );
}
