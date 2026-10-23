/**
 * AI agents — live from the AI Agent Registry (src/lib/agents/registry.ts). A newly published
 * agent is searchable as soon as the registry cache refreshes (30 s); nothing is hardcoded.
 *
 * Employees see active, published agents (the same "live team" getOrgDirectory() exposes).
 * Admins also see drafts and paused agents, labeled with their status. Only capability-card
 * fields are searched — never instructions or private configuration.
 */

import "server-only";

import { canViewWorkspace, getAgentAccess } from "@/lib/agents/permissions";
import type { ResolvedAgent } from "@/lib/agents/types";
import type { SearchContext } from "../context";
import type { ProviderHit, SearchProvider } from "../provider";
import { safeId } from "../safety";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  draft: "Draft",
  paused: "Paused",
  archived: "Archived",
};

async function visibleAgents(ctx: SearchContext): Promise<ResolvedAgent[]> {
  if (!canViewWorkspace(ctx.requester)) return [];
  const { listResolvedAgents } = await import("@/lib/agents/registry");
  const all = await listResolvedAgents();
  return all.filter((a) =>
    ctx.isAdmin ? a.row.status !== "archived" : a.row.status === "active" && a.versionId !== null,
  );
}

async function toHit(
  ctx: SearchContext,
  a: ResolvedAgent,
  fields: Set<string>,
): Promise<ProviderHit | null> {
  const slug = safeId(a.row.slug, /^[a-z0-9][a-z0-9-]{0,62}$/);
  if (!slug) return null;
  const access = await getAgentAccess(ctx.requester, a).catch(() => new Set<string>());
  const d = a.config.delegation;
  const department = a.department?.name ?? null;
  const status = STATUS_LABEL[a.row.status] ?? a.row.status;
  const canChat = access.has("direct_chat");
  return {
    recordId: slug,
    title: a.row.display_name,
    subtitle: [a.row.title, department].filter(Boolean).join(" · ") || null,
    description: a.row.description,
    breadcrumb: ["AI Workspace", department ?? "Agents"].filter(Boolean),
    url: `/ai/agents/${slug}`,
    icon: "bot",
    avatarUrl: a.row.avatar_url,
    updatedAt: a.row.updated_at,
    preview: [
      { label: "Status", value: a.row.status_label || status },
      { label: "Kind", value: a.row.kind === "orchestrator" ? "Orchestrator" : "Specialist" },
    ],
    auth: "internal",
    actions: canChat
      ? [
          {
            kind: "open",
            label: `Chat with ${a.row.display_name}`,
            href: `/ai/agents/${slug}?tab=chat`,
          },
        ]
      : [],
    match: {
      title: a.row.display_name,
      subtitle: a.row.title,
      fields: [
        fields.has("department") ? department : null,
        fields.has("specialization") ? d.specialization : null,
        ...(fields.has("tasks") ? d.supportedTasks : []),
      ],
      keywords: fields.has("keywords") ? d.keywords : [],
      description: a.row.description,
    },
  };
}

export const agentsProvider: SearchProvider = {
  id: "agents",
  category: "agents",
  name: "AI agents",
  icon: "bot",
  sourceSystem: "ai_registry",
  description: "Published agents from the AI Agent Registry (name, title, department, status).",
  searchableFields: [
    { key: "name", label: "Name & title", sensitivity: "standard", defaultEnabled: true },
    { key: "department", label: "Department", sensitivity: "standard", defaultEnabled: true },
    {
      key: "specialization",
      label: "Specialization",
      sensitivity: "standard",
      defaultEnabled: true,
    },
    { key: "tasks", label: "Supported tasks", sensitivity: "standard", defaultEnabled: true },
    { key: "keywords", label: "Routing keywords", sensitivity: "standard", defaultEnabled: true },
    {
      key: "instructions",
      label: "Private instructions",
      sensitivity: "restricted",
      defaultEnabled: false,
    },
  ],
  optional: false,
  indexing: "registry",
  permissionSummary:
    "Any approved employee sees active published agents; admins also see drafts and paused agents. Chat links only appear with Direct chat access.",
  minQueryLength: 1,
  timeoutMs: 2500,
  async canUse(ctx) {
    return canViewWorkspace(ctx.requester);
  },
  async availability() {
    return { available: true };
  },
  async search(ctx, input) {
    const agents = await visibleAgents(ctx);
    const hits = await Promise.all(agents.map((a) => toHit(ctx, a, input.fields)));
    return {
      hits: hits.filter((h): h is ProviderHit => h !== null),
      freshness: { kind: "registry" },
    };
  },
  async lookup(ctx, ids) {
    const all = new Set(["name", "department", "specialization", "tasks", "keywords"]);
    const agents = (await visibleAgents(ctx)).filter((a) => ids.includes(a.row.slug));
    const hits = await Promise.all(agents.map((a) => toHit(ctx, a, all)));
    return hits.filter((h): h is ProviderHit => h !== null);
  },
  async emptyState(ctx) {
    const agents = (await visibleAgents(ctx)).sort(
      (a, b) =>
        Number(b.row.kind === "orchestrator") - Number(a.row.kind === "orchestrator") ||
        a.row.display_name.localeCompare(b.row.display_name),
    );
    const hits = await Promise.all(agents.slice(0, 6).map((a) => toHit(ctx, a, new Set())));
    return hits.filter((h): h is ProviderHit => h !== null);
  },
};
