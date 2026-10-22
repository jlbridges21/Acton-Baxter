import type { Metadata } from "next";
import { AiPageShell } from "@/components/ai/ai-page";
import { ApprovalsQueue } from "@/components/ai/approvals";
import { PageHeader } from "@/components/ai/ui";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requireActiveUser();
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Approvals"
        description="Drafts and decisions agents can't make on their own. Agents never send employee communications — a person reviews, edits, and sends them."
      />
      <ApprovalsQueue />
    </AiPageShell>
  );
}
