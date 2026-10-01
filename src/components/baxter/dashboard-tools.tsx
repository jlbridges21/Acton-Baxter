"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, ExternalLink, type LucideIcon } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { LayoutViewToggle } from "@/components/ui/layout-view-toggle";
import { BAXTER_ADMIN_CARDS, getEnabledBaxterTools, type BaxterTool } from "@/lib/baxter/tools";
import {
  getDashboardToolsView,
  getServerDashboardToolsView,
  setDashboardToolsView,
  subscribeDashboardToolsView,
} from "@/lib/baxter/dashboard-tools-view";

type ToolEntry = {
  key: string;
  name: string;
  description: string;
  href: string;
  ctaLabel: string;
  icon: LucideIcon;
  external?: boolean;
};

const toolCtaClass =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)] sm:w-auto";

const listCtaClass =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)] sm:w-auto";

export function DashboardTools({ isAdmin }: { isAdmin: boolean }) {
  const view = useSyncExternalStore(
    subscribeDashboardToolsView,
    getDashboardToolsView,
    getServerDashboardToolsView,
  );
  const tools = getEnabledBaxterTools({ isAdmin });
  const entries: ToolEntry[] = [
    ...tools,
    ...(isAdmin ? BAXTER_ADMIN_CARDS.map((card) => ({ ...card })) : []),
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Tools</h2>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">Open a tool to work.</p>
        </div>
        <LayoutViewToggle view={view} onChange={setDashboardToolsView} label="Tools layout" />
      </div>

      {view === "list" ? (
        <ul
          data-testid="dashboard-tool-list"
          className="divide-y divide-[var(--acton-border)] overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white shadow-sm"
        >
          {entries.map((tool) => (
            <ToolRow key={tool.key} tool={tool} />
          ))}
        </ul>
      ) : (
        <div data-testid="dashboard-tool-grid" className="grid gap-4 md:grid-cols-2">
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
      )}
    </section>
  );
}

function ToolAction({
  tool,
  className,
}: {
  tool: Pick<ToolEntry, "href" | "ctaLabel" | "external">;
  className: string;
}) {
  const content = (
    <>
      {tool.ctaLabel}
      {tool.external ? (
        <ExternalLink className="h-4 w-4" aria-hidden />
      ) : (
        <ArrowRight className="h-4 w-4" aria-hidden />
      )}
    </>
  );
  if (tool.external) {
    return (
      <a href={tool.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }
  return (
    <Link href={tool.href} className={className}>
      {content}
    </Link>
  );
}

function ExternalMark() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--acton-muted)]">
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      Leaves Baxter
    </span>
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
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{tool.name}</CardTitle>
          {tool.external ? <ExternalMark /> : null}
        </div>
        <CardDescription className="mt-2">{tool.description}</CardDescription>
      </div>
      <div className="mt-6">
        <ToolAction tool={tool} className={toolCtaClass} />
      </div>
    </Card>
  );
}

function ToolRow({ tool }: { tool: ToolEntry }) {
  const Icon = tool.icon;
  return (
    <li className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--acton-navy)] text-[var(--acton-yellow)]">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">{tool.name}</p>
            {tool.external ? <ExternalMark /> : null}
          </div>
          <p className="mt-0.5 text-sm break-words text-[var(--acton-muted)]">{tool.description}</p>
        </div>
      </div>
      <div className="min-w-0 sm:shrink-0">
        <ToolAction tool={tool} className={listCtaClass} />
      </div>
    </li>
  );
}
