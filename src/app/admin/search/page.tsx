import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SearchAdmin } from "@/components/admin/search-admin";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Global Search" };

export default async function GlobalSearchAdminPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Global Search</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Search providers, index health, searchable fields, synonyms, and measured performance.
          Restricted fields can never be made searchable.
        </p>
      </div>
      <SearchAdmin />
    </AppShell>
  );
}
