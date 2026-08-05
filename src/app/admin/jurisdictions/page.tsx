import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { JurisdictionsClient } from "@/components/admin/jurisdictions-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { listKnowledgeEntries } from "@/lib/knowledge/store";
import {
  SUPPORTED_JURISDICTIONS,
  JURISDICTION_RULE_KEY_CATALOG,
  listCodeDocumentsForJurisdiction,
  listJurisdictionRules,
  type KnowledgeDocKind,
} from "@/lib/jurisdictions";

export default async function AdminJurisdictionsPage() {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");

  const [rules, unassignedEntries] = await Promise.all([
    listJurisdictionRules(),
    listKnowledgeEntries({ status: "all", sort: "title" }),
  ]);

  function toAssociable(entry: (typeof unassignedEntries)[number]) {
    return {
      id: entry.id,
      title: entry.title,
      status: entry.status,
      jurisdiction_key: entry.jurisdiction_key ?? null,
      doc_kind: (entry.doc_kind ?? null) as KnowledgeDocKind | null,
      source_name: entry.source_name,
      source_url: entry.source_url,
      updated_at: entry.updated_at,
    };
  }

  const documentsByJurisdiction: Record<string, ReturnType<typeof toAssociable>[]> = {};
  for (const jurisdiction of SUPPORTED_JURISDICTIONS) {
    const docs = await listCodeDocumentsForJurisdiction(jurisdiction.key);
    documentsByJurisdiction[jurisdiction.key] = docs.map(toAssociable);
  }

  return (
    <AppShell user={user}>
      <JurisdictionsClient
        initial={{
          jurisdictions: SUPPORTED_JURISDICTIONS,
          ruleKeyCatalog: JURISDICTION_RULE_KEY_CATALOG,
          rules,
          documentsByJurisdiction,
          associableEntries: unassignedEntries
            .filter((entry) => entry.status !== "archived")
            .map(toAssociable),
        }}
      />
    </AppShell>
  );
}
