import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { SurveysListClient } from "@/components/surveys/surveys-list-client";
import { requireActiveUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/errors";
import { listSurveys } from "@/lib/surveys/store";
import type { SurveySummary } from "@/lib/surveys/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Surveys" };

export default async function SurveysPage() {
  const user = await requireActiveUser();
  let surveys: SurveySummary[] = [];
  let loadError: string | null = null;
  try {
    surveys = await listSurveys();
  } catch (error) {
    logServerError("SurveysPage", error);
    loadError = "Surveys couldn't be loaded. Refresh to try again.";
  }

  return (
    <AppShell user={user}>
      <SurveysListClient
        initialSurveys={surveys}
        viewer={{ id: user.id, profile: { role: user.profile.role } }}
        loadError={loadError}
      />
    </AppShell>
  );
}
