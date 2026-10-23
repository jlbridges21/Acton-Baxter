import { requireAdmin } from "@/lib/auth/session";
import { listEvalCases } from "@/lib/baxter-ai/evaluations";
import { BaxterEvaluationsClient } from "@/components/admin/baxter-evaluations-client";
import { BaxterOrgQuality } from "@/components/admin/baxter-org-quality";
import { getOrgQuality } from "@/lib/agents/org-quality";

export default async function BaxterEvaluationsPage() {
  await requireAdmin();
  const [cases, orgQuality] = await Promise.all([
    listEvalCases(),
    getOrgQuality().catch(() => null),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">Baxter Evaluations</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Deterministic regression checks for structured, semantic, multimodal, and Slack
          organizational recall.
        </p>
      </div>
      {orgQuality && <BaxterOrgQuality quality={orgQuality} />}
      <BaxterEvaluationsClient
        initialCases={cases.map((c) => ({
          id: c.id,
          question: c.question,
          category: c.category,
        }))}
      />
    </div>
  );
}
