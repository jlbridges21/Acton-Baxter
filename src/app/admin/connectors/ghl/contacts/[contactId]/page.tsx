import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GhlContactDetailClient } from "@/components/admin/ghl-contact-detail-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";

export default async function AdminGhlContactDetailPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const write = canUserWriteGhl(user.profile);
  return (
    <AppShell user={user}>
      <GhlContactDetailClient canWrite={write.canWrite} />
    </AppShell>
  );
}
