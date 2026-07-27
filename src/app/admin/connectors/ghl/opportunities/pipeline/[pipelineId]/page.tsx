import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { GhlPipelineBoardClient } from "@/components/admin/ghl-pipeline-board-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";

export default async function AdminGhlPipelineBoardPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const write = canUserWriteGhl(user.profile);
  return (
    <AppShell user={user}>
      <GhlPipelineBoardClient canWrite={write.canWrite} />
    </AppShell>
  );
}
