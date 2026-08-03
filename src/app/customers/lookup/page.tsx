import { AppShell } from "@/components/layout/app-shell";
import { CustomerDossierClient } from "@/components/customers/customer-dossier-client";
import { requireActiveUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { assembleCustomerDossier } from "@/lib/dossier/assemble";

export default async function CustomerLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; contactId?: string; pemId?: string }>;
}) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const q = params.q?.trim() || null;
  const contactId = params.contactId?.trim() || null;
  const pemId = params.pemId?.trim() || null;
  const isAdmin = isAdminRole(user.profile.role);

  const dossier =
    q || contactId || pemId
      ? await assembleCustomerDossier({
          name: q,
          contactId,
          pemNeatId: pemId,
          role: user.profile.role,
        })
      : null;

  return (
    <AppShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Customer Dossier</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          One read-only view of what Baxter already knows across GoHighLevel, PEM NEAT, and Project
          Setup
          {isAdmin ? ", plus open Process Monitoring findings" : ""}.
        </p>
      </div>
      <CustomerDossierClient
        dossier={dossier}
        isAdmin={isAdmin}
        initialQuery={q ?? contactId ?? pemId ?? ""}
      />
    </AppShell>
  );
}
