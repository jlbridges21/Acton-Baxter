import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ reportId: string }> };

/** Property Research moved to /property-research; keep old processing links working. */
export default async function LegacyProcessingPage({ params }: PageProps) {
  const { reportId } = await params;
  redirect(`/property-research/${encodeURIComponent(reportId)}/processing`);
}
