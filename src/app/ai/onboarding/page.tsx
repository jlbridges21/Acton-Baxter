import type { Metadata } from "next";
import { AiPageShell } from "@/components/ai/ai-page";
import { OnboardingOverview } from "@/components/ai/onboarding";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const user = await requireActiveUser();
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Onboarding"
        description="Onboarding templates and new-hire progress. Sam reads these to answer questions like “what's the status of our new hire's onboarding?” Visible to people with access to the HR agent."
      />
      <OnboardingOverview />
    </AiPageShell>
  );
}
