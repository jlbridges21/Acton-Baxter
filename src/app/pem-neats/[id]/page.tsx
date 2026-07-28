import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PemNeatResultClient } from "@/components/pem-neat/pem-neat-result-client";
import { requireActiveUser } from "@/lib/auth/session";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type PageProps = { params: Promise<{ id: string }> };

export default async function PemNeatDetailPage({ params }: PageProps) {
  const user = await requireActiveUser();
  const { id } = await params;
  const item = await getPemNeatStore().get(id);
  if (!item) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <PemNeatResultClient item={item} />
    </AppShell>
  );
}
