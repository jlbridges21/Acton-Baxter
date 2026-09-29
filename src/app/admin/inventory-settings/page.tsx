import { redirect } from "next/navigation";
import { InventorySettingsClient } from "@/components/admin/inventory-settings-client";
import { AppShell } from "@/components/layout/app-shell";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listInventoryVocab } from "@/lib/inventory/store";

export const dynamic = "force-dynamic";

export default async function InventorySettingsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const [statuses, storageStates] = await Promise.all([
    listInventoryVocab("status"),
    listInventoryVocab("storage"),
  ]);

  return (
    <AppShell user={user}>
      <InventorySettingsClient statuses={statuses} storageStates={storageStates} />
    </AppShell>
  );
}
