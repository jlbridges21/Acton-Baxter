/**
 * Organization-aware intent interpretation for Baxter. Runs before delegation and before any
 * CRM / knowledge lookups, using the live agent directory (not a hardcoded roster), the recent
 * conversation, and the names of people who could share an agent's name.
 *
 * It decides between:
 *   agent_info        — a question ABOUT an agent ("Who is Sam?", "What does Dexter do?")
 *   agent_can_help    — "Can Sam help with onboarding?" (answered from the agent's published card)
 *   agent_status      — "Is Dexter working on anything?"
 *   org_roster        — "Which agents do you have?", "Who reports to you?", "Which agent handles HR?"
 *   capability_inventory — "What tools / systems can you use?"
 *   agent_task        — work FOR an agent ("Ask Sam to …", "Have her check …") → delegation
 *   clarify           — a name that could be an agent or a person, with nothing to decide by
 *   none              — not about the AI organization (CRM, projects, knowledge …)
 *
 * Pure and deterministic: no model calls, so it's fast and testable. It never decides
 * authorization — delegation and tools re-check access.
 */

import type { AgentCard, OrgDirectory } from "./directory";

export type OrgIntentKind =
  | "agent_info"
  | "agent_can_help"
  | "agent_status"
  | "org_roster"
  | "capability_inventory"
  | "agent_task"
  | "clarify"
  | "none";

export type OrgIntent = {
  kind: OrgIntentKind;
  agent: AgentCard | null;
  /** For agent_can_help / org_roster: the task or area asked about ("onboarding", "HR"). */
  topic: string | null;
  /** The question with pronouns / clarification answers resolved (used for downstream routing). */
  resolvedQuestion: string;
  /** One-line, non-sensitive explanation for traces and the quality dashboard. */
  reason: string;
  /** The agent's name refers to a record in another system (CRM contact, employee) — don't delegate on it. */
  recordReference?: boolean;
};

export type HistoryTurn = { role: "user" | "assistant"; content: string };

const CRM_CUE =
  /\b(ghl|gohighlevel|go high level|crm|contact|contacts|customer|client|lead|leads|opportunit(y|ies)|pipeline|homeowner|prospect|phone number|email address|address of|deal)\b/i;
const OTHER_SYSTEM_CUE =
  /\b(jobtread|job tread|bamboohr|bamboo hr|slack channel|in slack|employee record|employee directory|our employee)\b/i;
const PRONOUNS = /\b(she|her|hers|he|him|his|they|them|their)\b/i;
export const CLARIFY_MARKER = "or a person named";

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameRegex(a: AgentCard): RegExp {
  const names = [
    ...new Set(
      [a.name, a.slug]
        .filter(Boolean)
        .map((n) => esc(n.toLowerCase()).replace(/[-\s]+/g, "[-\\s]?")),
    ),
  ];
  return new RegExp(`(^|[^a-z0-9])@?(${names.join("|")})(?=$|[^a-z0-9])`, "i");
}

export function mentionedAgents(text: string, dir: OrgDirectory): AgentCard[] {
  const all = [...(dir.orchestrator ? [dir.orchestrator] : []), ...dir.agents];
  return all.filter((a) => nameRegex(a).test(text));
}

/** The agent most recently referred to in the conversation (for "she", "her", "they"). */
export function lastReferencedAgent(history: HistoryTurn[], dir: OrgDirectory): AgentCard | null {
  for (let i = history.length - 1; i >= Math.max(0, history.length - 8); i--) {
    const m = mentionedAgents(history[i]!.content, dir).filter((a) => a.kind === "specialist");
    if (m.length === 1) return m[0]!;
    if (m.length > 1) return null; // ambiguous; don't guess
  }
  return null;
}

/** Recent turns were about a CRM person (so a bare name likely means that person). */
function recentCrmContext(history: HistoryTurn[]): boolean {
  return history
    .slice(-4)
    .some((t) => CRM_CUE.test(t.content) || /gohighlevel|ghl contact/i.test(t.content));
}

function replacePronouns(q: string, agent: AgentCard): string {
  return q
    .replace(/\b(she|he|they)\b/gi, agent.name)
    .replace(/\b(her|him|them)\b/gi, agent.name)
    .replace(/\b(hers|his|their)\b/gi, `${agent.name}'s`);
}

const ROSTER =
  /\b((which|what) (ai )?(agents|ai employees|specialists|ai team|bots)|who (reports|works) (to|for) (you|baxter)|your (ai )?(team|agents|employees|specialists|staff)|what (ai )?(agents|employees) do you (have|manage)|which agents are (active|available)|list (the |your |all )?(ai )?agents|who('s| is) on your team|the ai (team|organization|org))\b/i;
// Two capture groups: [1] after "which agent …", [2] after "who handles …".
const WHO_HANDLES =
  /\b(?:which|what) (?:ai )?(?:agent|specialist|employee|one)(?: of yours)? (?:handles|does|is responsible for|takes care of|covers|can help with|should i (?:ask|use|talk to|go to)(?: about| for| with)?)\s+(.+?)\??$|\bwho (?:handles|is responsible for|takes care of) (.+?)\??$/i;
const INVENTORY =
  /\b(what|which) (tools|integrations|systems|data sources|capabilities|apps) (do you|can you|are) (have|use|access|connected|available)|\bwhat can you (access|connect to)\b|\bwhat systems (are|is) connected\b|\bwhich systems can you (use|read)\b/i;
const STATUS =
  /\b(is|are)\s+\S+\s+(currently |still )?(working on|busy|doing)|\bwhat('s| is)\s+\S+\s+(working on|doing|up to)\b|\b\S+'s (current )?(tasks|status|workload)\b/i;
const CAN_HELP =
  /\bcan\s+(\S+(?:\s\S+)?)\s+(help( me| us)?( with)?|do|handle|assist( with)?|take care of)\s+(.+?)\??$/i;
const INFO =
  /\b(who('s| is| are)|what('s| is| does| do| can)|tell me (about|more about)|describe|explain|introduce)\b/i;
const TASK =
  /^(please\s+)?(can you\s+|could you\s+)?(ask|have|get|tell|let|loop in|check with|send (this|it) to|delegate (this|it) to)\s+(?!me\b|us\b)/i;
/** "Is Sam able to…", "Can Sam access…" — about the agent's ability, even when another system is named. */
const ABILITY = (name: string) =>
  new RegExp(
    `\\b(can|could|is|does|do|will)\\s+@?${esc(name)}\\s+(able to|have access|has access|access|use|connect|read|look|see|pull|check|search|get into|work with)\\b`,
    "i",
  );
const ADDRESSED = (name: string) => new RegExp(`^@?${esc(name)}\\s*[,:]`, "i");

export function interpretOrgRequest(input: {
  question: string;
  history: HistoryTurn[];
  directory: OrgDirectory;
  /** First names of Baxter users / employees who could share an agent's name. */
  peopleFirstNames?: string[];
}): OrgIntent {
  const original = input.question.trim();
  const none = (reason: string, resolvedQuestion = original): OrgIntent => ({
    kind: "none",
    agent: null,
    topic: null,
    resolvedQuestion,
    reason,
  });
  const dir = input.directory;
  if (!original) return none("Empty question.");

  // 1) Answer to our own "agent or a person?" question.
  const lastAssistant = [...input.history].reverse().find((t) => t.role === "assistant");
  if (lastAssistant?.content.includes(CLARIFY_MARKER)) {
    const asked =
      mentionedAgents(lastAssistant.content, dir).find((a) => a.kind === "specialist") ?? null;
    if (asked) {
      if (
        /\b(agent|ai|bot|the (hr|ai)|your|baxter's|specialist|first)\b/i.test(original) &&
        !/\b(person|contact|customer|client|employee|human|second)\b/i.test(original)
      ) {
        return {
          kind: "agent_info",
          agent: asked,
          topic: null,
          resolvedQuestion: `Who is ${asked.name}?`,
          reason: `Clarified: the AI agent ${asked.name}.`,
        };
      }
      if (
        /\b(person|contact|customer|client|lead|human|employee|second|crm|ghl)\b/i.test(original)
      ) {
        return none(
          `Clarified: a person named ${asked.name}, not the agent.`,
          `Who is ${asked.name} in GoHighLevel?`,
        );
      }
    }
  }

  // 2) Resolve pronouns to the agent the conversation is about ("Can she help with onboarding?").
  let q = original;
  const recent = lastReferencedAgent(input.history, dir);
  if (recent && PRONOUNS.test(q) && mentionedAgents(q, dir).length === 0)
    q = replacePronouns(q, recent);

  // 3) Organization-wide questions.
  if (INVENTORY.test(q))
    return {
      kind: "capability_inventory",
      agent: null,
      topic: null,
      resolvedQuestion: q,
      reason: "Asks which tools or systems are available.",
    };
  const handles = WHO_HANDLES.exec(q);
  if (handles && !mentionedAgents(q, dir).some((a) => a.kind === "specialist")) {
    const topic = (handles[1] ?? handles[2] ?? "").trim();
    return {
      kind: "org_roster",
      agent: null,
      topic: topic || null,
      resolvedQuestion: q,
      reason: `Asks which agent handles "${topic}".`,
    };
  }
  if (ROSTER.test(q))
    return {
      kind: "org_roster",
      agent: null,
      topic: null,
      resolvedQuestion: q,
      reason: "Asks about the AI team.",
    };

  const mentions = mentionedAgents(q, dir);
  const specialists = mentions.filter((a) => a.kind === "specialist");
  const agent = specialists.length === 1 ? specialists[0]! : null;
  if (!agent) {
    // "Who are you?" / Baxter itself stays with Baxter's identity handling.
    return none(specialists.length > 1 ? "Mentions several agents." : "No agent mentioned.", q);
  }

  // 4) Work FOR an agent → delegation (with the name restored for the router).
  if (TASK.test(q) || ADDRESSED(agent.name).test(q)) {
    return {
      kind: "agent_task",
      agent,
      topic: null,
      resolvedQuestion: q,
      reason: `Asks ${agent.name} to do something.`,
    };
  }

  // 5) Ability questions stay with the agent ("Is Sam able to look up employee info in BambooHR?");
  //    otherwise explicit other-system context means a record, not the agent ("Who is Sam in GoHighLevel?").
  if (ABILITY(agent.name).test(q))
    return {
      kind: "agent_info",
      agent,
      topic: null,
      resolvedQuestion: q,
      reason: `Asks what ${agent.name} can currently do.`,
    };
  if (CRM_CUE.test(q) || OTHER_SYSTEM_CUE.test(q))
    return {
      ...none(`"${agent.name}" here refers to a record in another system.`, q),
      recordReference: true,
    };

  // 6) Questions about the agent.
  if (STATUS.test(q))
    return {
      kind: "agent_status",
      agent,
      topic: null,
      resolvedQuestion: q,
      reason: `Asks what ${agent.name} is working on.`,
    };
  const can = CAN_HELP.exec(q);
  if (can && nameRegex(agent).test(can[1] ?? "")) {
    return {
      kind: "agent_can_help",
      agent,
      topic: (can[6] ?? "").trim() || null,
      resolvedQuestion: q,
      reason: `Asks whether ${agent.name} can help with something.`,
    };
  }
  if (INFO.test(q)) {
    const shortWhoIs = /^\s*(who('s| is)|what('s| is))\s+@?\S+\s*\??\s*$/i.test(q);
    const nameTaken = (input.peopleFirstNames ?? []).some(
      (n) => n.toLowerCase() === agent.name.toLowerCase(),
    );
    if (shortWhoIs && (recentCrmContext(input.history) || nameTaken)) {
      return {
        kind: "clarify",
        agent,
        topic: null,
        resolvedQuestion: q,
        reason: `"${agent.name}" could be the AI agent or a person${nameTaken ? " (an employee has this name)" : " (the conversation was about CRM contacts)"}.`,
      };
    }
    return {
      kind: "agent_info",
      agent,
      topic: null,
      resolvedQuestion: q,
      reason: `Asks about the AI agent ${agent.name}.`,
    };
  }
  // Mentions the agent with a task-like request but no "ask"/"have" — let the router decide.
  return {
    kind: "agent_task",
    agent,
    topic: null,
    resolvedQuestion: q,
    reason: `Mentions ${agent.name} with a request.`,
  };
}

/**
 * Fit between a topic ("HR", "employee onboarding") and an agent's published card, 0–1. Words in
 * the title / specialization / department count most; supported tasks, keywords and description
 * less; 5-letter prefix matches least. Multi-word topics need most words covered, so
 * "construction scheduling" doesn't match an agent that merely mentions construction.
 */
export function topicFit(topic: string, a: AgentCard): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOP.has(w)),
    );
  const forms = (w: string) => [w, w.endsWith("s") ? w.slice(0, -1) : `${w}s`];
  const t = [...tokens(topic)];
  if (!t.length) return 0;
  const strong = tokens([a.title, a.specialization, a.department ?? ""].join(" "));
  const weak = tokens([a.supportedTasks.join(" "), a.keywords.join(" "), a.description].join(" "));
  let score = 0;
  let covered = 0;
  for (const w of t) {
    if (forms(w).some((f) => strong.has(f))) {
      score += 1;
      covered += 1;
    } else if (forms(w).some((f) => weak.has(f))) {
      score += 0.7;
      covered += 1;
    } else if (w.length > 4 && [...strong, ...weak].some((h) => h.startsWith(w.slice(0, 5)))) {
      score += 0.35;
      covered += 0.5;
    }
  }
  const raw = score / t.length;
  if (covered / t.length < 0.67) return raw * 0.5;
  // Multi-word topics must match together in one clause of the card: "construction scheduling"
  // shouldn't fit an agent whose card says "Acton Construction … interview scheduling".
  if (t.length > 1) {
    const clauses = [a.title, a.specialization, a.description, ...a.supportedTasks]
      .join("\n")
      .split(/[,;:.•()\n]+|\s[—–-]\s|\s(?:and|or)\s/i)
      .map(tokens);
    const together = clauses.some(
      (c) => t.filter((w) => forms(w).some((f) => c.has(f))).length >= Math.ceil(t.length * 0.67),
    );
    if (!together) return raw * 0.4;
  }
  return raw;
}
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "our",
  "about",
  "can",
  "help",
  "that",
  "this",
  "what",
  "who",
  "which",
  "does",
  "any",
  "your",
  "you",
  "me",
  "us",
  "of",
  "to",
  "in",
  "on",
  "an",
  "is",
  "do",
]);
