import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { BaxterDiagnosticsClient } from "@/components/admin/baxter-diagnostics-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getBaxterDiagnosticsSnapshot } from "@/lib/baxter-ai/diagnostics";

export default async function BaxterDiagnosticsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const snapshot = await getBaxterDiagnosticsSnapshot();
  return (
    <AppShell user={user}>
      <BaxterDiagnosticsClient initial={snapshot} />
    </AppShell>
  );
}
