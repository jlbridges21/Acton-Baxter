import Link from "next/link";
import { ArrowRight, Construction } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { BAXTER_ADMIN_CARDS, getEnabledBaxterTools, type BaxterTool } from "@/lib/baxter/tools";
import { CompanyLogo } from "@/components/branding/company-logo";

export function BaxterDashboard({
  isAdmin = false,
  logoUrl = null,
  companyName = "Acton ADU",
  logoAlt = "Acton ADU - Baxter",
}: {
  isAdmin?: boolean;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const tools = getEnabledBaxterTools({ isAdmin });

  return (
    <div className="space-y-8">
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

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Tools</h2>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Open a tool to work. Navigation becomes tool-specific after you enter it.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool.key} tool={tool} />
          ))}
          {isAdmin
            ? BAXTER_ADMIN_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <Card key={card.key} className="flex h-full flex-col justify-between">
                    <div>
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--acton-navy)] text-[var(--acton-yellow)]">
                        <Icon className="h-5 w-5" aria-hidden />
                      </div>
                      <CardTitle>{card.name}</CardTitle>
                      <CardDescription className="mt-2">{card.description}</CardDescription>
                    </div>
                    <div className="mt-6">
                      <Link
                        href={card.href}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
                      >
                        {card.ctaLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </Card>
                );
              })
            : null}
        </div>
      </section>

      <section>
        <Card className="border-dashed bg-[var(--acton-gray-50)]">
          <div className="flex items-start gap-3">
            <Construction className="mt-0.5 h-5 w-5 text-[var(--acton-muted)]" />
            <div>
              <CardTitle className="text-base">More Baxter tools coming later</CardTitle>
              <CardDescription className="mt-2">
                A knowledge-backed Slack assistant and related Baxter capabilities are planned for
                later prompts. They are not available yet.
              </CardDescription>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ToolCard({ tool }: { tool: BaxterTool }) {
  const Icon = tool.icon;
  return (
    <Card className="flex h-full flex-col justify-between">
      <div>
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--acton-navy)] text-[var(--acton-yellow)]">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <CardTitle>{tool.name}</CardTitle>
        <CardDescription className="mt-2">{tool.description}</CardDescription>
      </div>
      <div className="mt-6">
        <Link
          href={tool.href}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
        >
          {tool.ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </Card>
  );
}
