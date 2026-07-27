import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GhlOpportunityDetailClient } from "@/components/admin/ghl-opportunity-detail-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";

export default async function AdminGhlOpportunityDetailPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const write = canUserWriteGhl(user.profile);
  return (
    <AppShell user={user}>
      <GhlOpportunityDetailClient canWrite={write.canWrite} />
    </AppShell>
  );
}
