import type { Metadata } from "next";
import { AiPageShell } from "@/components/ai/ai-page";
import { TemplateEditor } from "@/components/ai/onboarding";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboarding template" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  const { id } = await params;
  return (
    <AiPageShell user={user}>
      <TemplateEditor id={id} />
    </AiPageShell>
  );
}
