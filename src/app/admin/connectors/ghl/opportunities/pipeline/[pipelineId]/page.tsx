import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";

/**
 * Legacy pipeline board URL → canonical Acton CRM opportunities tab.
 */
export default async function AdminGhlPipelineBoardRedirectPage({
  params,
}: {
  params: Promise<{ pipelineId: string }>;
}) {
  const user = await requireActiveUser();
  if (!isAdminRole(user.profile.role)) redirect("/");
  const { pipelineId } = await params;
  const qs = new URLSearchParams({
    tab: "opportunities",
    pipeline: pipelineId,
  });
  redirect(`/admin/connectors/ghl?${qs.toString()}`);
}
