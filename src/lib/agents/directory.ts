/**
 * Live AI-organization directory: what Baxter knows about its agents and their tools, read from
 * the published Agent Registry at request time (cached briefly by the registry). Nothing here is
 * hardcoded per agent — a newly published, active agent appears automatically.
 *
 * Only public "capability card" information is exposed: names, titles, departments, descriptions,
 * specialization, supported tasks, tools (labels + whether they actually work right now), and the
 * requester's own access level. Private instructions are never included.
 */

import "server-only";

import type { Requester, ResolvedAgent } from "./types";

export type ToolStatus = {
  key: string;
  label: string;
  source: string;
  risk: string;
  ready: boolean;
  detail: string;
};

export type AgentCard = {
  slug: string;
  name: string;
  title: string;
  kind: "orchestrator" | "specialist";
  department: string | null;
  description: string;
  specialization: string;
  supportedTasks: string[];
  reportsTo: string | null;
  status: string;
  acceptsDelegation: boolean;
  profileUrl: string;
  keywords: string[];
};

export type OrgDirectory = {
  orchestrator: AgentCard | null;
  agents: AgentCard[];
  generatedAt: string;
};

function card(a: ResolvedAgent, byId: Map<string, ResolvedAgent>): AgentCard {
  const d = a.config.delegation;
  return {
    slug: a.row.slug,
    name: a.row.display_name,
    title: a.row.title,
    kind: a.row.kind,
    department: a.department?.name ?? null,
    description: a.row.description,
    specialization: d.specialization,
    supportedTasks: d.supportedTasks,
    reportsTo: a.row.manager_agent_id
      ? (byId.get(a.row.manager_agent_id)?.row.display_name ?? null)
      : null,
    status: a.row.status,
    acceptsDelegation: d.acceptsDelegation,
    profileUrl: `/ai/agents/${a.row.slug}`,
    keywords: d.keywords,
  };
}

/** Active, published agents (drafts, paused, and archived agents are not part of the live team). */
export async function getOrgDirectory(): Promise<OrgDirectory> {
  const { listResolvedAgents } = await import("./registry");
  const all = await listResolvedAgents();
  const byId = new Map(all.map((a) => [a.row.id, a]));
  const live = all.filter((a) => a.row.status === "active" && a.versionId !== null);
  const orchestrator = live.find((a) => a.row.kind === "orchestrator") ?? null;
  return {
    orchestrator: orchestrator ? card(orchestrator, byId) : null,
    agents: live.filter((a) => a.row.kind === "specialist").map((a) => card(a, byId)),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tool metadata and readiness (configured ≠ operational)
// ---------------------------------------------------------------------------
type ToolLike = {
  key: string;
  label: string;
  risk: string;
  available: boolean;
  unavailableReason?: string;
  source?: string;
  readiness?: () => Promise<{ ready: boolean; detail: string }>;
};

const ok = (detail: string) => ({ ready: true, detail });
const no = (detail: string) => ({ ready: false, detail });

/** Default source/readiness by tool family; a tool's own `source`/`readiness` always wins. */
const FAMILIES: Array<{
  match: RegExp;
  source: string;
  readiness: () => Promise<{ ready: boolean; detail: string }>;
}> = [
  {
    match: /^reports_/,
    source: "JobTread (Reports)",
    readiness: async () => {
      const { isJobTreadConfigured } = await import("@/lib/jobtread/client");
      return isJobTreadConfigured()
        ? ok("JobTread is connected.")
        : no("JobTread isn't connected, so reports can't load live project data.");
    },
  },
  {
    match: /^bamboohr_/,
    source: "BambooHR",
    readiness: async () => {
      const { getConnection } = await import("@/lib/bamboohr/connection");
      const c = await getConnection().catch(() => null);
      return c?.status === "connected"
        ? ok("BambooHR is connected (read-only).")
        : no(
            c?.status === "reauthorization_required"
              ? "BambooHR needs to be reconnected by the COO."
              : "BambooHR isn't connected yet.",
          );
    },
  },
  {
    match: /^ops_/,
    source: "Sam Operations",
    readiness: async () => {
      const { getOpsRoles } = await import("@/lib/ops/org");
      const roles = await getOpsRoles().catch(() => null);
      if (!roles) return no("Sam Operations isn't set up in this environment yet.");
      return roles.ceo || roles.coo
        ? ok("Sam Operations is set up; consequential actions still need CEO/COO approval.")
        : no(
            "Works for tracking, but nothing can be approved until the CEO and COO accounts are confirmed in Sam Operations → Setup.",
          );
    },
  },
  {
    match: /^knowledge_search$/,
    source: "Knowledge Hub",
    readiness: async () => ok("Searches approved Knowledge Hub documents."),
  },
  {
    match: /^onboarding_/,
    source: "Onboarding tracker",
    readiness: async () => ok("Reads Baxter's onboarding records."),
  },
  {
    match: /^(draft_communication|flag_for_review)$/,
    source: "Approvals queue",
    readiness: async () => ok("Saves items for human review; nothing is sent automatically."),
  },
];

export async function toolStatus(tool: ToolLike): Promise<ToolStatus> {
  const family = FAMILIES.find((f) => f.match.test(tool.key));
  const source = tool.source ?? family?.source ?? "Baxter";
  if (!tool.available)
    return {
      key: tool.key,
      label: tool.label,
      source,
      risk: tool.risk,
      ready: false,
      detail: tool.unavailableReason ?? "Not built yet.",
    };
  const check = tool.readiness ?? family?.readiness;
  try {
    const r = check ? await check() : ok("Available.");
    return { key: tool.key, label: tool.label, source, risk: tool.risk, ...r };
  } catch {
    return {
      key: tool.key,
      label: tool.label,
      source,
      risk: tool.risk,
      ready: false,
      detail: "Couldn't confirm this tool's connection.",
    };
  }
}

/** An agent's enabled tools with live readiness, grouped by source system. */
export async function agentCapabilities(slug: string): Promise<{
  sources: Array<{ source: string; ready: boolean; detail: string; tools: string[] }>;
  plannedTools: string[];
} | null> {
  const { getResolvedAgent } = await import("./registry");
  const { getTool } = await import("./tools");
  const agent = await getResolvedAgent(slug);
  if (!agent) return null;
  const statuses = await Promise.all(
    agent.config.tools.enabled
      .map((k) => getTool(k))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => toolStatus(t)),
  );
  const bySource = new Map<string, ToolStatus[]>();
  for (const s of statuses) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  return {
    sources: [...bySource.entries()].map(([source, tools]) => ({
      source,
      ready: tools.every((t) => t.ready),
      detail: tools.find((t) => !t.ready)?.detail ?? tools[0]?.detail ?? "",
      tools: tools.map((t) => t.label),
    })),
    plannedTools: statuses
      .filter((s) => s.detail.startsWith("Not built") || s.detail.includes("not available"))
      .map((s) => s.label),
  };
}

/** Baxter's own integrations plus every specialist's tools, with what's actually working. */
export async function capabilityInventory(): Promise<
  Array<{ system: string; ready: boolean; detail: string; via: string }>
> {
  const out: Array<{ system: string; ready: boolean; detail: string; via: string }> = [];
  const { isGhlConfigured } = await import("@/lib/connectors/ghl/config");
  out.push({
    system: "GoHighLevel CRM",
    ready: isGhlConfigured(),
    detail: isGhlConfigured()
      ? "Contacts, opportunities, and activity (changes need your confirmation)."
      : "Not connected in this environment.",
    via: "Baxter",
  });
  out.push({
    system: "Knowledge Center",
    ready: true,
    detail: "Approved company documents and synced Google Drive files.",
    via: "Baxter",
  });
  const dir = await getOrgDirectory();
  for (const a of dir.agents) {
    const caps = await agentCapabilities(a.slug);
    for (const s of caps?.sources ?? [])
      out.push({ system: s.source, ready: s.ready, detail: s.detail, via: a.name });
  }
  return out;
}

/** The requester's access to each agent, for honest "can I use X?" answers. */
export async function accessSummary(
  requester: Requester,
  slug: string,
): Promise<"direct" | "via_baxter" | "none" | "unverified"> {
  if (requester.verifiedVia === "unverified") return "unverified";
  const { getResolvedAgent } = await import("./registry");
  const { getAgentAccess } = await import("./permissions");
  const agent = await getResolvedAgent(slug);
  if (!agent) return "none";
  const levels = await getAgentAccess(requester, agent);
  return levels.has("direct_chat")
    ? "direct"
    : levels.has("use_via_baxter")
      ? "via_baxter"
      : "none";
}
