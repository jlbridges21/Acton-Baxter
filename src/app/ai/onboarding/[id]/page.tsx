import type { Metadata } from "next";
import { AiPageShell } from "@/components/ai/ai-page";
import { InstanceProgress } from "@/components/ai/onboarding";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Onboarding progress" };

export default async function InstancePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  const { id } = await params;
  return (
    <AiPageShell user={user}>
      <InstanceProgress id={id} />
    </AiPageShell>
  );
}
