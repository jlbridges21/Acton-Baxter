/**
 * Grounded answers about Baxter's AI organization, built from the live Agent Registry and real
 * tool readiness — no model call, so they are fast, consistent between Slack and web, and never
 * claim a capability that isn't actually working.
 */

import "server-only";

import type { BaxterSourceReference } from "@/lib/baxter-ai/types";
import {
  accessSummary,
  agentCapabilities,
  capabilityInventory,
  type AgentCard,
  type OrgDirectory,
} from "./directory";
import { CLARIFY_MARKER, topicFit, type OrgIntent } from "./intent";
import type { Requester } from "./types";

type Channel = "web" | "slack";
export type OrgAnswer = { answer: string; sources: BaxterSourceReference[] };

const bold = (s: string, ch: Channel) => (ch === "slack" ? `*${s}*` : `**${s}**`);
const bullet = (s: string) => `• ${s}`;

function abs(path: string, baseUrl: string) {
  return path.startsWith("http") ? path : `${baseUrl.replace(/\/$/, "")}${path}`;
}

function registrySource(a: AgentCard, baseUrl: string, index = 0): BaxterSourceReference {
  return {
    title: `${a.name} — ${a.title}`,
    sourceName: "Agent Registry",
    category: a.department ?? "AI Workforce",
    sourceUrl: abs(a.profileUrl, baseUrl),
    citationLabel: `Agent Registry — ${a.name}`,
    sourceKind: "capability",
    openLabel: "Open agent profile",
    lastUpdated: null,
    relevanceScore: 100 - index,
    availability: "available",
    knowledgeEntryId: `agent-registry-${a.slug}`,
  };
}

function rosterSource(baseUrl: string): BaxterSourceReference {
  return {
    title: "AI Office",
    sourceName: "Agent Registry",
    category: "AI Workforce",
    sourceUrl: abs("/ai/agents", baseUrl),
    citationLabel: "Agent Registry — AI team",
    sourceKind: "capability",
    openLabel: "Open AI team",
    lastUpdated: null,
    relevanceScore: 100,
    availability: "available",
    knowledgeEntryId: "agent-registry-roster",
  };
}

const ACCESS_TEXT = {
  direct: "You can chat with them directly in the AI Workspace or ask through me.",
  via_baxter: "You can use them by asking me.",
  none: "Your account doesn't have access to them yet — an administrator can grant it in AI Studio.",
  unverified: "I couldn't confirm your Baxter account, so I can't hand them requests from here.",
} as const;

async function readinessLines(a: AgentCard, ch: Channel): Promise<string[]> {
  const caps = await agentCapabilities(a.slug);
  if (!caps) return [];
  return caps.sources.map((s) =>
    bullet(`${bold(s.source, ch)}: ${s.ready ? "working" : "not working yet"} — ${s.detail}`),
  );
}

export async function composeOrgAnswer(input: {
  intent: OrgIntent;
  directory: OrgDirectory;
  requester: Requester;
  channel: Channel;
  baseUrl: string;
}): Promise<OrgAnswer> {
  const { intent, directory: dir, channel: ch, baseUrl } = input;
  const me = dir.orchestrator?.name ?? "Baxter";

  if (intent.kind === "clarify" && intent.agent) {
    const a = intent.agent;
    return {
      answer: `Do you mean ${bold(a.name, ch)}, our ${aiTitle(a.title)}, ${CLARIFY_MARKER} ${a.name} (for example a contact in GoHighLevel)?`,
      sources: [],
    };
  }

  if ((intent.kind === "agent_info" || intent.kind === "agent_can_help") && intent.agent) {
    const a = intent.agent;
    const access = await accessSummary(input.requester, a.slug);
    const wantsCurrent =
      /\b(currently|right now|actually|today|working|access|connected|able|can)\b/i.test(
        intent.resolvedQuestion,
      );
    const lines: string[] = [];
    if (intent.kind === "agent_can_help") {
      const topic = intent.topic ?? "";
      const fit = topicFit(topic, a);
      if (fit >= 0.5) {
        lines.push(
          `Yes — ${topic ? `${topic} is` : "that's"} part of ${bold(a.name, ch)}'s role as our ${a.title}.`,
        );
      } else {
        const better = dir.agents
          .filter((x) => x.slug !== a.slug)
          .map((x) => ({ x, f: topicFit(topic, x) }))
          .sort((p, q) => q.f - p.f)[0];
        lines.push(
          `That isn't part of ${bold(a.name, ch)}'s published responsibilities (${a.specialization || a.title}).`,
        );
        if (better && better.f >= 0.5)
          lines.push(
            `${bold(better.x.name, ch)} (${better.x.title}) is a better fit for ${topic || "that"}.`,
          );
      }
    } else {
      lines.push(
        `${bold(a.name, ch)} is our ${aiTitle(a.title)}${a.department ? ` in ${a.department}` : ""}${a.reportsTo ? `, reporting to ${a.reportsTo === me ? "me" : a.reportsTo}` : ""}.`,
      );
      if (a.description) lines.push(a.description);
      if (a.supportedTasks.length)
        lines.push(
          `${a.name} can help with:\n${a.supportedTasks.slice(0, 6).map(bullet).join("\n")}`,
        );
    }
    if (wantsCurrent || intent.kind === "agent_can_help") {
      const ready = await readinessLines(a, ch);
      if (ready.length) lines.push(`What's working right now:\n${ready.join("\n")}`);
    }
    lines.push(ACCESS_TEXT[access]);
    if (a.acceptsDelegation && (access === "direct" || access === "via_baxter"))
      lines.push(`Want me to ask ${a.name} something?`);
    return { answer: lines.join("\n\n"), sources: [registrySource(a, baseUrl)] };
  }

  if (intent.kind === "agent_status" && intent.agent) {
    const a = intent.agent;
    const { getResolvedAgent } = await import("./registry");
    const { listTasks } = await import("./tasks");
    const { isAdminRole } = await import("@/lib/auth/roles");
    const row = await getResolvedAgent(a.slug);
    const admin = isAdminRole(input.requester.role) && input.requester.verifiedVia !== "unverified";
    // People see their own requests; administrators see the agent's whole queue.
    const tasks = row
      ? await listTasks({
          agentId: row.row.id,
          status: ["queued", "running", "awaiting_approval"],
          ...(admin ? {} : { initiatingUserId: input.requester.userId ?? "-" }),
          limit: 10,
        }).catch(() => [])
      : [];
    const answer = tasks.length
      ? `${bold(a.name, ch)} is working on ${tasks.length} ${admin ? "" : "of your "}request${tasks.length === 1 ? "" : "s"}:\n${tasks
          .slice(0, 5)
          .map((t) => bullet(`${t.title} — ${t.status.replace(/_/g, " ")}`))
          .join("\n")}`
      : `${bold(a.name, ch)} has no ${admin ? "requests" : "requests of yours"} in progress right now.`;
    return { answer, sources: [registrySource(a, baseUrl)] };
  }

  if (intent.kind === "org_roster") {
    if (intent.topic) {
      const ranked = dir.agents
        .map((x) => ({ x, f: topicFit(intent.topic!, x) }))
        .sort((p, q) => q.f - p.f);
      const best = ranked[0];
      if (best && best.f >= 0.5) {
        return {
          answer:
            `${bold(best.x.name, ch)}, our ${best.x.title}, handles ${intent.topic}. ${best.x.specialization ? `${best.x.name} covers ${lowerFirst(best.x.specialization)}` : ""}`.trim() +
            `\n\nWant me to ask ${best.x.name}?`,
          sources: [registrySource(best.x, baseUrl)],
        };
      }
      return {
        answer: `None of my AI agents is set up for ${intent.topic} right now. I'll handle what I can directly, or an administrator can add an agent for it in AI Studio.`,
        sources: [rosterSource(baseUrl)],
      };
    }
    if (!dir.agents.length)
      return {
        answer: "I don't have any active AI agents on my team right now.",
        sources: [rosterSource(baseUrl)],
      };
    const list = dir.agents
      .map((x) =>
        bullet(`${bold(x.name, ch)} — ${x.title}${x.department ? ` (${x.department})` : ""}`),
      )
      .join("\n");
    return {
      answer: `My AI team${dir.agents.every((x) => x.reportsTo === me) ? " (they all report to me)" : ""}:\n${list}\n\nAsk me about any of them, or tell me what you need and I'll bring in the right one.`,
      sources: [
        rosterSource(baseUrl),
        ...dir.agents.map((x, i) => registrySource(x, baseUrl, i + 1)),
      ].slice(0, 6),
    };
  }

  if (intent.kind === "capability_inventory") {
    const inv = await capabilityInventory();
    const working = inv.filter((i) => i.ready);
    const notYet = inv.filter((i) => !i.ready);
    const fmt = (i: (typeof inv)[number]) =>
      bullet(`${bold(i.system, ch)}${i.via !== me ? ` (via ${i.via})` : ""} — ${i.detail}`);
    const parts = [
      `Here's what I can use right now:\n${working.map(fmt).join("\n") || bullet("Nothing is connected yet.")}`,
    ];
    if (notYet.length) parts.push(`Set up but not working yet:\n${notYet.map(fmt).join("\n")}`);
    return { answer: parts.join("\n\n"), sources: [rosterSource(baseUrl)] };
  }

  return { answer: "", sources: [] };
}

/** "Turns data…" → "turns data…", but leave acronyms and brand names ("HR", "JobTread") alone. */
function lowerFirst(s: string) {
  return s && !/^[A-Z][A-Z]|^[A-Z][a-z]+[A-Z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** "AI Reporting Specialist" stays as is; "HR Coordinator" becomes "AI HR Coordinator". */
function aiTitle(title: string) {
  return /^ai\b/i.test(title) ? title : `AI ${title}`;
}
