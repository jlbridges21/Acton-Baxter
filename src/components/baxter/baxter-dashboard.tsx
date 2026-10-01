import { Construction } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { DashboardTools } from "@/components/baxter/dashboard-tools";
import { BaxterChatLauncher } from "@/components/baxter-chat/baxter-chat-launcher";
import { CompanyLogo } from "@/components/branding/company-logo";

export function BaxterDashboard({
  isAdmin = false,
  logoUrl = null,
  companyName = "Acton ADU",
  logoAlt = "Acton ADU",
  chatEnabled = false,
}: {
  isAdmin?: boolean;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
  chatEnabled?: boolean;
}) {
  return (
    <div className="relative space-y-8">
      <div className="space-y-4">
        <CompanyLogo
          href="/"
          logoUrl={logoUrl}
          companyName={companyName}
          productLabel="Baxter"
          alt={logoAlt}
          className="sm:hidden"
        />
        <div>
          <p className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            Baxter by Acton ADU
          </p>
          <h1 className="mt-1 text-3xl font-bold text-[var(--acton-navy)]">Baxter</h1>
          <p className="mt-2 max-w-2xl text-base text-[var(--acton-muted)]">
            Acton ADU’s internal tools and knowledge platform
          </p>
        </div>
      </div>

      <DashboardTools isAdmin={isAdmin} />

      <section>
        <Card className="border-dashed bg-[var(--acton-gray-50)]">
          <div className="flex items-start gap-3">
            <Construction className="mt-0.5 h-5 w-5 text-[var(--acton-muted)]" />
            <div>
              <CardTitle className="text-base">More Baxter tools coming later</CardTitle>
              <CardDescription className="mt-2">
                Slack conversations and additional Acton system integrations are planned for later
                prompts. They are not available yet.
              </CardDescription>
            </div>
          </div>
        </Card>
      </section>

      {chatEnabled ? <BaxterChatLauncher /> : null}
    </div>
  );
}
