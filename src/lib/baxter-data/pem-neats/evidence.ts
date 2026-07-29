/**
 * PEM NEAT evidence retrieval for Baxter — completed structured NEATs only.
 */
import "server-only";

import { getPublicEnv } from "@/lib/env.public";
import type { BaxterContextItem, BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import { ASSESSMENT_CATEGORY_LABELS } from "@/lib/pem-neat/constants";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import type { PemNeatListItem, PemNeatRecord } from "@/lib/pem-neat/types";
import {
  detectPemIntent,
  extractNameQuery,
  type PemFieldFocus,
  type PemIntentResult,
} from "./intent";

export type PemEvidenceResult = {
  items: BaxterContextItem[];
  clarification: string | null;
  staleWarning: string | null;
};

export function canAccessPemEvidence(
  role: string | null | undefined,
  options?: { channel?: "web" | "slack" },
): boolean {
  if (role === "new_user") return false;
  if (role === "user" || role === "admin" || role === "super_admin") return true;
  // Slack employees are already workspace-gated; web requires a known employee role.
  if (!role && options?.channel === "slack") return true;
  return false;
}

export function pemNeatPath(id: string): string {
  return `/pem-neats/${id}`;
}

export function pemNeatAbsoluteUrl(id: string): string {
  const base = (getPublicEnv().APP_BASE_URL || "").replace(/\/$/, "");
  const path = pemNeatPath(id);
  return base ? `${base}${path}` : path;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value: string): string[] {
  return normalizeName(value).split(" ").filter(Boolean);
}

export function scoreNameMatch(prospectName: string, query: string): number {
  const p = normalizeName(prospectName);
  const q = normalizeName(query);
  if (!q) return 0;
  if (p === q) return 100;
  if (p.includes(q) || q.includes(p)) return 80;
  const pt = nameTokens(prospectName);
  const qt = nameTokens(query);
  if (qt.length === 1) return pt.includes(qt[0]!) ? 60 : 0;
  const overlap = qt.filter((t) => pt.includes(t)).length;
  if (overlap === qt.length) return 90;
  if (overlap > 0) return 40 + overlap * 10;
  return 0;
}

function inheritNameFromHistory(history: BaxterHistoryMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    if (msg.role === "user") {
      const fromQ = extractNameQuery(msg.content);
      if (fromQ) return fromQ;
    }
    if (msg.role === "assistant") {
      const fromCite = msg.content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*—\s*PEM NEAT\b/);
      if (fromCite?.[1]) return fromCite[1];
      const fromProspect = msg.content.match(/^Prospect:\s*(.+)$/m);
      if (fromProspect?.[1]?.trim()) return fromProspect[1].trim();
    }
  }
  return null;
}

function evidencedText(
  value: { value?: string | number | null } | string | null | undefined,
): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value.value == null || value.value === "") return "";
  return String(value.value);
}

function formatMeetingDate(value: string | null): string {
  if (!value) return "undated";
  const d = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function asStructured(raw: unknown): PemNeatStructuredResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as PemNeatStructuredResult;
  if (!o.salesIntelligence || !o.assessment) return null;
  return o;
}

function joinPain(items: Array<{ statement?: string | null }> | undefined): string {
  if (!items?.length) return "Not established in the saved NEAT.";
  return items
    .map((i) => i.statement?.trim())
    .filter(Boolean)
    .join(" ");
}

export function formatFocusedExcerpt(
  record: PemNeatRecord,
  result: PemNeatStructuredResult,
  fields: PemFieldFocus[],
): string {
  const si = result.salesIntelligence;
  const lines: string[] = [
    `Prospect: ${record.prospect_name}`,
    `Salesperson: ${record.salesperson_display_name}`,
    `Meeting date: ${formatMeetingDate(record.meeting_date)}`,
  ];
  if (record.analysis_stale || record.status === "needs_regeneration") {
    lines.push(
      "Note: This NEAT may be based on an older transcript version (stale / needs regeneration).",
    );
  }

  const want = new Set(fields);
  const summary = want.has("summary");

  if (summary || want.has("customer_story") || want.has("identity")) {
    lines.push("", `Customer Story:\n${si.customerStory || "Not established."}`);
  }
  if (summary || want.has("customer_pain")) {
    lines.push("", `Customer Pain:\n${si.customerPain || "Not established."}`);
  }
  if (summary || want.has("type1_pain")) {
    lines.push("", `Type 1 Pain:\n${joinPain(si.type1Pain)}`);
  }
  if (summary || want.has("type2_pain")) {
    lines.push("", `Type 2 Pain:\n${joinPain(si.type2Pain)}`);
  }
  if (summary || want.has("budget")) {
    const b = si.budget;
    lines.push(
      "",
      "Budget:",
      b.summary || "Not established.",
      evidencedText(b.statedBudget) ? `Stated/available: ${evidencedText(b.statedBudget)}` : "",
      evidencedText(b.target) ? `Target: ${evidencedText(b.target)}` : "",
      evidencedText(b.hardCeiling) ? `Upper threshold: ${evidencedText(b.hardCeiling)}` : "",
      b.scope ? `Scope: ${b.scope}` : "",
      b.fundingSource ? `Funding: ${b.fundingSource}` : "",
    );
  }
  if (summary || want.has("decision")) {
    const d = si.decisionProcess;
    lines.push(
      "",
      "Decision process:",
      d.summary || d.process || "Not established.",
      d.decisionMakers?.length
        ? `Decision makers: ${d.decisionMakers
            .map((m) => evidencedText(m))
            .filter(Boolean)
            .join("; ")}`
        : "",
      d.alternatives?.length ? `Alternatives: ${d.alternatives.join("; ")}` : "",
      evidencedText(d.timing) ? `Timing: ${evidencedText(d.timing)}` : "",
    );
  }
  if (want.has("schedule")) {
    const s = si.schedule;
    lines.push(
      "",
      "Schedule:",
      s.summary || "Not established.",
      s.flexibility ? `Flexibility/urgency: ${s.flexibility}` : "",
    );
  }
  if (want.has("alternatives")) {
    lines.push(
      "",
      `Competition / alternatives:\n${
        (si.competitionAlternatives ?? []).join("; ") ||
        si.decisionProcess.alternatives?.join("; ") ||
        "Not established."
      }`,
    );
  }
  if (want.has("recommendation")) {
    lines.push(
      "",
      "Acton recommendation:",
      si.actonRecommendation.fit || "Not established.",
      si.actonRecommendation.reasoning || "",
    );
  }
  if (summary || want.has("next_steps") || want.has("commitments")) {
    lines.push(
      "",
      "Next steps:",
      `Prospect: ${(si.nextSteps.prospect ?? []).join("; ") || "None listed"}`,
      `Acton: ${(si.nextSteps.acton ?? []).join("; ") || "None listed"}`,
    );
  }
  if (summary || want.has("outcome")) {
    lines.push(
      "",
      `Meeting outcome: ${si.meetingOutcome.classification}`,
      si.meetingOutcome.explanation || "",
    );
  }
  if (want.has("qualification")) {
    lines.push(
      "",
      `Qualification: ${si.qualification.classification}`,
      si.qualification.reasoning || "",
    );
  }
  if (want.has("assessment") || want.has("coaching")) {
    const a = result.assessment;
    lines.push(
      "",
      "Sales assessment:",
      a.topStrengths?.length ? `Top strengths: ${a.topStrengths.join("; ")}` : "",
      a.topImprovements?.length ? `Top improvements: ${a.topImprovements.join("; ")}` : "",
      a.oneThing ? `The One Thing: ${a.oneThing}` : "",
    );
    for (const cat of a.categories ?? []) {
      if (want.has("coaching") && !want.has("assessment")) {
        if (!cat.coachingOpportunity && !cat.whatWorked) continue;
      }
      const label =
        ASSESSMENT_CATEGORY_LABELS[cat.key as keyof typeof ASSESSMENT_CATEGORY_LABELS] ?? cat.label;
      lines.push(
        `- ${label}: score ${cat.score ?? "N/A"} (${cat.status})`,
        cat.evidence ? `  Evidence: ${cat.evidence}` : "",
        cat.whatWorked ? `  What worked: ${cat.whatWorked}` : "",
        cat.coachingOpportunity ? `  Coaching: ${cat.coachingOpportunity}` : "",
      );
    }
  }
  if (want.has("salesperson")) {
    lines.push("", `Salesperson / advisor: ${record.salesperson_display_name}`);
  }
  if (want.has("project") || want.has("handoff")) {
    const facts = result.projectIntelligence?.facts ?? [];
    lines.push(
      "",
      "Project intelligence:",
      facts.length
        ? facts
            .slice(0, 12)
            .map((f) => `- ${f.topic}: ${f.value ?? "unknown"} (${f.status})`)
            .join("\n")
        : "No project facts saved.",
      result.internalOpportunityNotes
        ? `Internal opportunity notes: ${result.internalOpportunityNotes}`
        : "",
    );
  }
  if (want.has("buildertrend") || want.has("handoff")) {
    const bt = (result.buildertrendFields ?? record.buildertrend_fields ?? {}) as Record<
      string,
      unknown
    >;
    const interesting = Object.entries(bt)
      .filter(([, v]) => {
        if (v == null || v === "") return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      })
      .slice(0, 20);
    lines.push(
      "",
      "BuilderTrend custom fields (non-empty):",
      interesting.length
        ? interesting
            .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join("\n")
        : "No non-empty BuilderTrend fields saved.",
    );
  }

  return lines.filter((l) => l !== "").join("\n");
}

export async function retrievePemEvidence(input: {
  question: string;
  history?: BaxterHistoryMessage[];
  role?: string | null;
  channel?: "web" | "slack";
}): Promise<PemEvidenceResult> {
  if (!canAccessPemEvidence(input.role, { channel: input.channel })) {
    return { items: [], clarification: null, staleWarning: null };
  }

  const intent: PemIntentResult = detectPemIntent(input.question);
  if (intent.intent !== "record_lookup") {
    return { items: [], clarification: null, staleWarning: null };
  }

  let nameQuery = intent.nameQuery;
  if (!nameQuery && input.history?.length) {
    const q = input.question;
    if (/\b(his|her|their|he|she|they|that|this)\b/i.test(q) || q.trim().split(/\s+/).length <= 8) {
      nameQuery = inheritNameFromHistory(input.history);
    }
  }

  if (!nameQuery) {
    return {
      items: [],
      clarification:
        "Which prospect's PEM NEAT should I use? Please include their name (for example: Robert Vertin).",
      staleWarning: null,
    };
  }

  const store = getPemNeatStore();
  const listed = await store.list({ query: nameQuery, status: "completed" });
  const staleListed =
    listed.length === 0 ? await store.list({ query: nameQuery, status: "needs_regeneration" }) : [];
  const candidates = [...listed, ...staleListed].filter(
    (row) => scoreNameMatch(row.prospect_name, nameQuery!) >= 40,
  );

  if (candidates.length === 0) {
    return {
      items: [],
      clarification: `I couldn't find a completed PEM NEAT for ${nameQuery}.`,
      staleWarning: null,
    };
  }

  const byPerson = new Map<string, PemNeatListItem[]>();
  for (const row of candidates) {
    const key = normalizeName(row.prospect_name);
    const arr = byPerson.get(key) ?? [];
    arr.push(row);
    byPerson.set(key, arr);
  }

  if (byPerson.size > 1) {
    const names = [...byPerson.values()].map((rows) => rows[0]!.prospect_name);
    return {
      items: [],
      clarification: `I found multiple matching PEMs. Do you mean ${names.join(" or ")}?`,
      staleWarning: null,
    };
  }

  const personRows = [...byPerson.values()][0]!;
  personRows.sort((a, b) => {
    const da = a.meeting_date ?? a.generated_at ?? a.updated_at;
    const db = b.meeting_date ?? b.generated_at ?? b.updated_at;
    return String(db).localeCompare(String(da));
  });

  let chosen = personRows[0]!;
  if (intent.wantsFirst && personRows.length > 1) {
    chosen = personRows[personRows.length - 1]!;
  }
  if (intent.dateHint) {
    const hint = intent.dateHint.toLowerCase();
    const match = personRows.find((r) =>
      formatMeetingDate(r.meeting_date).toLowerCase().includes(hint.slice(0, 3)),
    );
    if (match) chosen = match;
  }

  const full = await store.get(chosen.id);
  if (!full || full.deleted_at) {
    return {
      items: [],
      clarification: `I couldn't find a completed PEM NEAT for ${nameQuery}.`,
      staleWarning: null,
    };
  }

  if (full.status === "generating" || full.status === "failed" || full.status === "draft") {
    return {
      items: [],
      clarification: `I found ${full.prospect_name}, but there isn't a completed PEM NEAT available yet.`,
      staleWarning: null,
    };
  }

  const structured = asStructured(full.structured_result);
  if (!structured) {
    return {
      items: [],
      clarification: `I found ${full.prospect_name}'s PEM record, but the saved NEAT content isn't available.`,
      staleWarning: null,
    };
  }

  const staleWarning =
    full.analysis_stale || full.status === "needs_regeneration"
      ? `${full.prospect_name}'s saved NEAT may be based on an older transcript version, so this may be stale.`
      : personRows.length > 1 && intent.wantsLatest
        ? `Using ${full.prospect_name}'s most recent PEM from ${formatMeetingDate(full.meeting_date)}.`
        : null;

  const dateLabel = formatMeetingDate(full.meeting_date);
  const citationLabel = `${full.prospect_name} — PEM NEAT — ${dateLabel}`;
  const excerpt = formatFocusedExcerpt(full, structured, intent.fields);

  return {
    items: [
      {
        number: 1,
        id: full.id,
        title: citationLabel,
        summary: `${full.prospect_name} PEM with ${full.salesperson_display_name}`,
        contentExcerpt: staleWarning ? `${staleWarning}\n\n${excerpt}` : excerpt,
        category: "PEM NEAT",
        tags: ["pem_neat", ...intent.fields],
        sourceName: "Partnership Evaluation Meeting NEAT",
        sourceUrl: pemNeatAbsoluteUrl(full.id),
        sourceType: "pem_neat",
        mimeType: null,
        updatedAt: full.generated_at ?? full.updated_at,
        citationLabel,
        relevanceScore: 95,
      },
    ],
    clarification: null,
    staleWarning,
  };
}
