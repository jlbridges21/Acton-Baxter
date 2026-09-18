import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { InspectionRunnerClient } from "@/components/inspections/inspection-runner-client";
import { requireActiveUser } from "@/lib/auth/session";
import { getSiteInspection } from "@/lib/inspections";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function InspectionDetailPage({ params }: Params) {
  const user = await requireActiveUser();
  const { id } = await params;
  let inspection;
  try {
    inspection = await getSiteInspection(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <AppShell user={user}>
      <InspectionRunnerClient initialInspection={inspection} />
    </AppShell>
  );
}
