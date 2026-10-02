import { redirect } from "next/navigation";
import { SchemaErdClient } from "@/components/admin/schema-erd-client";
import { AppShell } from "@/components/layout/app-shell";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { loadSchemaErd } from "@/lib/schema-erd/load";

export const dynamic = "force-dynamic";

export default async function AdminSchemaPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/dashboard");

  const { schema, error } = await loadSchemaErd();

  return (
    <AppShell user={user} width="full">
      <SchemaErdClient schema={schema} error={error} userId={user.id} />
    </AppShell>
  );
}
