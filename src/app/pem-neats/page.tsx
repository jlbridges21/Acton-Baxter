import { AppShell } from "@/components/layout/app-shell";
import { PemNeatLibraryClient } from "@/components/pem-neat/pem-neat-library-client";
import { requireActiveUser } from "@/lib/auth/session";
import { getPemNeatStore } from "@/lib/pem-neat/store";

export default async function PemNeatsPage() {
  const user = await requireActiveUser();
  const items = await getPemNeatStore().list();

  return (
    <AppShell user={user}>
      <PemNeatLibraryClient initialItems={items} />
    </AppShell>
  );
}
