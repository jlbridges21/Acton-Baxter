import type { Metadata } from "next";
import { Suspense } from "react";
import { AiPageShell } from "@/components/ai/ai-page";
import { PageHeader } from "@/components/ai/ui";
import { OperationsStudio } from "@/components/ops/studio";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sam Operations" };

export default async function OperationsPage() {
  const user = await requireActiveUser();
  return (
    <AiPageShell user={user}>
      <PageHeader
        title="Sam Operations"
        description="HR, administration, and legal operations for Acton Construction and Acton ADU. Sam prepares and tracks the work; the CEO or COO approves every message, record change, and signature request."
      />
      <Suspense fallback={<p className="text-sm text-[var(--acton-muted)]">Loading…</p>}>
        <OperationsStudio />
      </Suspense>
    </AiPageShell>
  );
}
