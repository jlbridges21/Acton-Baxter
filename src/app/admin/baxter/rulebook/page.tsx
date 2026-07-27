import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { RulebookClient } from "@/components/admin/rulebook-client";

export default async function BaxterRulebookPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  return (
    <AppShell user={user}>
      <RulebookClient />
    </AppShell>
  );
}
