import { AppShell } from "@/components/layout/app-shell";
import { CreateWithDexter } from "@/components/report-builder/create-with-dexter";
import { ReportsNoAccess } from "@/components/report-builder/no-access";
import { loadReportsPageContext } from "@/lib/reports/page-access";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ prompt?: string | string[] }> };

export default async function NewReportPage({ searchParams }: PageProps) {
  const { user, access, dexterAvatarUrl } = await loadReportsPageContext();
  const raw = (await searchParams).prompt;
  const prompt = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 2000) ?? "";
  return (
    <AppShell user={user}>
      {access?.canUse ? (
        <CreateWithDexter
          canChat={access.canChat}
          dexterAvatarUrl={dexterAvatarUrl}
          initialPrompt={prompt}
        />
      ) : (
        <ReportsNoAccess />
      )}
    </AppShell>
  );
}
