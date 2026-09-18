import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { InspectionsShell } from "@/components/inspections/inspections-shell";
import { TemplateEditorClient } from "@/components/inspections/template-editor-client";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { getTemplate } from "@/lib/inspections";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function InspectionTemplateDetailPage({ params }: Params) {
  const user = await requireActiveUser();
  const { id } = await params;
  let template;
  try {
    template = await getTemplate(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <AppShell user={user}>
      <InspectionsShell
        activeView="templates"
        title={template.name}
        subtitle="Edit sections, items, guide notes, and sub-questions. Order is saved and reloads identically."
      >
        <TemplateEditorClient initialTemplate={template} isAdmin={isAdminRole(user.profile.role)} />
      </InspectionsShell>
    </AppShell>
  );
}
