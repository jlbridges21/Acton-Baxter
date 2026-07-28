import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PemNeatResultClient } from "@/components/pem-neat/pem-neat-result-client";
import { requireActiveUser } from "@/lib/auth/session";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type PageProps = { params: Promise<{ id: string }> };

export default async function PemNeatDetailPage({ params }: PageProps) {
  const user = await requireActiveUser();
  const { id } = await params;
  const store = getPemNeatStore();
  const item = await store.get(id);
  if (!item) {
    notFound();
  }

  let generationCount: number | null = null;
  try {
    const generations = await store.listGenerations(id);
    generationCount = generations.length;
  } catch {
    generationCount = null;
  }

  return (
    <AppShell user={user}>
      <PemNeatResultClient item={item} generationCount={generationCount} />
    </AppShell>
  );
}
