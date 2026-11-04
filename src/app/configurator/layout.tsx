import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ConfiguratorAdminProvider } from "@/components/configurator/admin/admin-context";
import { AdminShell } from "@/components/configurator/admin/admin-shell";
import { AppShell } from "@/components/layout/app-shell";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { loadAdminWorkspace } from "@/lib/configurator/server";
import { ConfiguratorSetupError } from "@/lib/configurator/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Configurator" };

/** Baxter admins only. Loads the draft once; sub-pages share the same working copy. */
export default async function ConfiguratorLayout({ children }: { children: ReactNode }) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  let data;
  try {
    data = await loadAdminWorkspace();
  } catch (error) {
    if (error instanceof ConfiguratorSetupError) {
      return (
        <AppShell user={user}>
          <div
            className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950"
            data-testid="configurator-setup"
          >
            <h1 className="text-xl font-bold">Configurator is not set up yet</h1>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              <li>
                Apply <code>supabase/migrations/086_configurator.sql</code> in the Baxter SQL
                editor.
              </li>
              <li>
                Import the existing models and renderings:{" "}
                <code>node_modules/.bin/jiti scripts/configurator-import.ts --target=supabase</code>
              </li>
              <li>Reload this page.</li>
            </ol>
          </div>
        </AppShell>
      );
    }
    throw error;
  }

  return (
    <AppShell user={user} width="full">
      <ConfiguratorAdminProvider initial={data}>
        <AdminShell>{children}</AdminShell>
      </ConfiguratorAdminProvider>
    </AppShell>
  );
}
