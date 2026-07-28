import { AppShell } from "@/components/layout/app-shell";
import { PemNeatCreateClient } from "@/components/pem-neat/pem-neat-create-client";
import { requireActiveUser } from "@/lib/auth/session";
import { listSalespeople } from "@/lib/pem-neat/salespeople";

export default async function NewPemNeatPage() {
  const user = await requireActiveUser();
  const salespeople = await listSalespeople();

  return (
    <AppShell user={user}>
      <PemNeatCreateClient salespeople={salespeople} defaultSalespersonId={user.id} />
    </AppShell>
  );
}
