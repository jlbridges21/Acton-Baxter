import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PemNeatResultClient } from "@/components/pem-neat/pem-neat-result-client";
import { isAdminRole } from "@/lib/auth/roles";
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

  let generations: Awaited<ReturnType<typeof store.listGenerations>> = [];
  try {
    generations = await store.listGenerations(id);
  } catch {
    generations = [];
  }

  return (
    <AppShell user={user}>
      <PemNeatResultClient
        item={item}
        generations={generations}
        isAdmin={isAdminRole(user.profile.role)}
      />
    </AppShell>
  );
}
