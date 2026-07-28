import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PemNeatEditClient } from "@/components/pem-neat/pem-neat-edit-client";
import { requireActiveUser } from "@/lib/auth/session";
import { listSalespeopleForEdit } from "@/lib/pem-neat/salespeople";
import { getPemNeatStore } from "@/lib/pem-neat/store";

type PageProps = { params: Promise<{ id: string }> };

export default async function PemNeatEditPage({ params }: PageProps) {
  const user = await requireActiveUser();
  const { id } = await params;
  const item = await getPemNeatStore().get(id);
  if (!item) notFound();

  const salespeople = await listSalespeopleForEdit(item.salesperson_user_id);

  return (
    <AppShell user={user}>
      <PemNeatEditClient item={item} salespeople={salespeople} />
    </AppShell>
  );
}
