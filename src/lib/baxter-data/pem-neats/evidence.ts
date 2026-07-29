/**
 * PEM NEAT evidence retrieval — deterministic field routing + entity resolution.
 */
import "server-only";

import { getPublicEnv } from "@/lib/env.public";
import type { BaxterContextItem, BaxterHistoryMessage } from "@/lib/baxter-ai/types";
import type { PemNeatStructuredResult } from "@/lib/pem-neat/schemas";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import type { PemNeatListItem, PemNeatRecord } from "@/lib/pem-neat/types";
import {
  extractDiscriminatorHint,
  looksLikePemDiscriminatorReply,
  readPemConversationState,
  type PemActiveContext,
  type PemConversationState,
  type PemPendingSelection,
} from "./conversation-state";
import {
  detectRequestedPemFields,
  formatDeterministicPemAnswer,
  getPemField,
  type PemFieldKey,
  type PemFieldValue,
} from "./fields";
import { detectPemIntent, parsePemEntityQuery, type PemIntentResult } from "./intent";

export type PemAnswerMode =
  "deterministic_structured" | "model_grounded" | "clarification" | "not_determinable" | "none";

export type PemResolutionDiagnostics = {
  detectedProspect: string | null;
  candidateCount: number;
  resolvedPemId: string | null;
  resolvedPemTitle: string | null;
  requestedFields: PemFieldKey[];
  inheritedFromConversation: boolean;
  explicitOverride: boolean;
  answerMode: PemAnswerMode;
};

export type PemEvidenceResult = {
  items: BaxterContextItem[];
  clarification: string | null;
  staleWarning: string | null;
  /** Deterministic employee-facing answer when field is resolved. */
  deterministicAnswer: string | null;
  answerMode: PemAnswerMode;
  diagnostics: PemResolutionDiagnostics;
  /** Updated conversation PEM state to persist (null = leave unchanged). */
  nextConversationState: PemConversationState | null;
};

function emptyDiagnostics(partial?: Partial<PemResolutionDiagnostics>): PemResolutionDiagnostics {
  return {
    detectedProspect: null,
    candidateCount: 0,
    resolvedPemId: null,
    resolvedPemTitle: null,
    requestedFields: [],
    inheritedFromConversation: false,
    explicitOverride: false,
    answerMode: "none",
    ...partial,
  };
}

export function canAccessPemEvidence(
  role: string | null | undefined,
  options?: { channel?: "web" | "slack" },
): boolean {
  if (role === "new_user") return false;
  if (role === "user" || role === "admin" || role === "super_admin") return true;
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

export function normalizeName(value: string): string {
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

/** Strip trailing "Test N" / version discriminators from a prospect label. */
export function stripDiscriminator(prospectName: string): string {
  return prospectName
    .replace(/\s+(test|pem|neat|meeting|version|v|#)\s*[\w.-]+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDiscriminatorFromName(prospectName: string): string | null {
  const m = prospectName.match(/\b((?:test|pem|neat|meeting|version|v|#)\s*[\w.-]+)$/i);
  return m?.[1] ?? null;
}

export function scoreNameMatch(prospectName: string, query: string): number {
  const p = normalizeName(prospectName);
  const q = normalizeName(query);
  if (!q) return 0;
  if (p === q) return 100;
  if (p.includes(q) || q.includes(p)) return 80;
  const baseP = normalizeName(stripDiscriminator(prospectName));
  if (baseP && (baseP === q || baseP.includes(q) || q.includes(baseP))) return 75;
  const pt = nameTokens(prospectName);
  const qt = nameTokens(query);
  if (qt.length === 1) return pt.includes(qt[0]!) ? 60 : 0;
  const overlap = qt.filter((t) => pt.includes(t)).length;
  if (overlap === qt.length) return 90;
  if (overlap > 0) return 40 + overlap * 10;
  return 0;
}

function discriminatorMatches(prospectName: string, hint: string): boolean {
  const nHint = normalizeName(hint);
  const nName = normalizeName(prospectName);
  if (!nHint) return false;
  if (nName.includes(nHint)) return true;
  const fromName = extractDiscriminatorFromName(prospectName);
  if (fromName && normalizeName(fromName) === nHint) return true;
  // "8" vs "Test 8"
  const hintNum = nHint.replace(/^test\s*/, "").trim();
  const nameDisc = fromName
    ? normalizeName(fromName)
        .replace(/^test\s*/, "")
        .trim()
    : "";
  return Boolean(hintNum && nameDisc && hintNum === nameDisc);
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

function citationFor(record: { prospect_name: string; meeting_date: string | null }): string {
  const disc = extractDiscriminatorFromName(record.prospect_name);
  if (disc) return `${record.prospect_name} — PEM NEAT`;
  return `${record.prospect_name} — PEM NEAT — ${formatMeetingDate(record.meeting_date)}`;
}

function pickByDiscriminator(rows: PemNeatListItem[], hint: string | null): PemNeatListItem | null {
  if (!hint) return null;
  const matches = rows.filter((r) => discriminatorMatches(r.prospect_name, hint));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    matches.sort((a, b) =>
      String(b.meeting_date ?? b.updated_at).localeCompare(String(a.meeting_date ?? a.updated_at)),
    );
    return matches[0]!;
  }
  return null;
}

function groupByBaseName(rows: PemNeatListItem[]): Map<string, PemNeatListItem[]> {
  const map = new Map<string, PemNeatListItem[]>();
  for (const row of rows) {
    const key = normalizeName(stripDiscriminator(row.prospect_name) || row.prospect_name);
    const arr = map.get(key) ?? [];
    arr.push(row);
    map.set(key, arr);
  }
  return map;
}

async function loadAndAnswer(input: {
  recordId: string;
  fields: PemFieldKey[];
  staleNote?: string | null;
  inherited: boolean;
  explicitOverride: boolean;
  activeState: PemActiveContext;
}): Promise<PemEvidenceResult> {
  const store = getPemNeatStore();
  const full = await store.get(input.recordId);
  if (!full || full.deleted_at) {
    return {
      items: [],
      clarification: "I couldn't find that completed PEM NEAT anymore.",
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        requestedFields: input.fields,
        inheritedFromConversation: input.inherited,
        explicitOverride: input.explicitOverride,
      }),
      nextConversationState: { pending: null, active: input.activeState },
    };
  }

  if (full.status === "generating" || full.status === "failed" || full.status === "draft") {
    return {
      items: [],
      clarification: `I found ${full.prospect_name}, but there isn't a completed PEM NEAT available yet.`,
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        detectedProspect: full.prospect_name,
        resolvedPemId: full.id,
        resolvedPemTitle: full.prospect_name,
        requestedFields: input.fields,
      }),
      nextConversationState: { pending: null, active: input.activeState },
    };
  }

  const structured = asStructured(full.structured_result);
  if (!structured) {
    return {
      items: [],
      clarification: `I found ${full.prospect_name}'s PEM record, but the saved NEAT content isn't available.`,
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        detectedProspect: full.prospect_name,
        resolvedPemId: full.id,
        resolvedPemTitle: full.prospect_name,
        requestedFields: input.fields,
      }),
      nextConversationState: {
        pending: null,
        active: {
          ...input.activeState,
          activePemId: full.id,
          activeProspectName: full.prospect_name,
        },
      },
    };
  }

  const staleWarning =
    full.analysis_stale || full.status === "needs_regeneration"
      ? `${full.prospect_name}'s saved NEAT may be based on an older transcript version, so this may be stale.`
      : (input.staleNote ?? null);

  const citationLabel = citationFor(full);
  const primaryField = input.fields[0] ?? "summary";
  const fieldValue: PemFieldValue = getPemField(structured, primaryField, {
    salespersonName: full.salesperson_display_name,
    buildertrendFallback: (full.buildertrend_fields ?? {}) as Record<string, unknown>,
  });

  // Multi-field: concatenate deterministic sections
  let deterministicAnswer: string;
  let answerMode: PemAnswerMode;
  if (input.fields.length === 1) {
    deterministicAnswer = formatDeterministicPemAnswer({
      prospectName: full.prospect_name,
      field: fieldValue,
      citationLabel,
    });
    answerMode = fieldValue.determinable ? "deterministic_structured" : "not_determinable";
  } else {
    const sections = input.fields.map((f) =>
      getPemField(structured, f, {
        salespersonName: full.salesperson_display_name,
        buildertrendFallback: (full.buildertrend_fields ?? {}) as Record<string, unknown>,
      }),
    );
    const parts = sections.map((s) =>
      s.determinable
        ? `${s.label}:\n${s.lines.map((l) => (l.startsWith("•") ? l : `• ${l}`)).join("\n")}`
        : `${s.label}: not determinable in this NEAT.`,
    );
    deterministicAnswer = [...parts, "", `Source: ${citationLabel}`].join("\n\n");
    answerMode = sections.some((s) => s.determinable)
      ? "deterministic_structured"
      : "not_determinable";
  }

  if (staleWarning) {
    deterministicAnswer = `${staleWarning}\n\n${deterministicAnswer}`;
  }

  const excerptLines = [
    `Prospect: ${full.prospect_name}`,
    `Requested field: ${fieldValue.label}`,
    `Value:`,
    ...(fieldValue.determinable ? fieldValue.lines : ["(not determinable)"]),
  ];

  const item: BaxterContextItem = {
    number: 1,
    id: full.id,
    title: citationLabel,
    summary: `${full.prospect_name} — ${fieldValue.label}`,
    contentExcerpt: excerptLines.join("\n"),
    category: "PEM NEAT",
    tags: ["pem_neat", primaryField, `field:${primaryField}`],
    sourceName: "Partnership Evaluation Meeting NEAT",
    sourceUrl: pemNeatAbsoluteUrl(full.id),
    sourceType: "pem_neat",
    mimeType: null,
    updatedAt: full.generated_at ?? full.updated_at,
    citationLabel,
    relevanceScore: 100,
  };

  const nextActive: PemActiveContext = {
    type: "pem_active",
    activePemId: full.id,
    activeProspectName: full.prospect_name,
    lastRequestedFields: input.fields,
    baseProspectHint: stripDiscriminator(full.prospect_name) || full.prospect_name,
  };

  return {
    items: [item],
    clarification: null,
    staleWarning,
    deterministicAnswer,
    answerMode,
    diagnostics: {
      detectedProspect: full.prospect_name,
      candidateCount: 1,
      resolvedPemId: full.id,
      resolvedPemTitle: full.prospect_name,
      requestedFields: input.fields,
      inheritedFromConversation: input.inherited,
      explicitOverride: input.explicitOverride,
      answerMode,
    },
    nextConversationState: { pending: null, active: nextActive },
  };
}

/**
 * Prefer formatFocusedExcerpt only for broader/model-grounded cases (kept for tests).
 */
export function formatFocusedExcerpt(
  record: PemNeatRecord,
  result: PemNeatStructuredResult,
  fields: Array<PemFieldKey | string>,
): string {
  const keys = fields.map((f) =>
    f === "type1_pain" ? "type_1_pain" : f === "type2_pain" ? "type_2_pain" : (f as PemFieldKey),
  );
  const lines: string[] = [
    `Prospect: ${record.prospect_name}`,
    `Salesperson: ${record.salesperson_display_name}`,
    `Meeting date: ${formatMeetingDate(record.meeting_date)}`,
  ];
  for (const key of keys.length ? keys : (["summary"] as PemFieldKey[])) {
    const value = getPemField(result, key, {
      salespersonName: record.salesperson_display_name,
      buildertrendFallback: (record.buildertrend_fields ?? {}) as Record<string, unknown>,
    });
    lines.push("", `${value.label}:`, ...(value.lines.length ? value.lines : ["Not established."]));
  }
  return lines.join("\n");
}

export async function retrievePemEvidence(input: {
  question: string;
  history?: BaxterHistoryMessage[];
  role?: string | null;
  channel?: "web" | "slack";
  conversationMetadata?: Record<string, unknown> | null;
}): Promise<PemEvidenceResult> {
  const none = (): PemEvidenceResult => ({
    items: [],
    clarification: null,
    staleWarning: null,
    deterministicAnswer: null,
    answerMode: "none",
    diagnostics: emptyDiagnostics(),
    nextConversationState: null,
  });

  if (!canAccessPemEvidence(input.role, { channel: input.channel })) {
    return none();
  }

  const pemState = readPemConversationState(input.conversationMetadata);
  const intent: PemIntentResult = detectPemIntent(input.question);
  const q = input.question.trim();

  // --- Pending clarification resolution ("Test 8") ---
  if (
    pemState.pending?.type === "pem_selection" &&
    (intent.intent === "pem_selection_reply" ||
      looksLikePemDiscriminatorReply(q) ||
      Boolean(intent.discriminator))
  ) {
    const hint = intent.discriminator || intent.switchPemHint || extractDiscriminatorHint(q) || q;
    const store = getPemNeatStore();
    const candidates: PemNeatListItem[] = [];
    for (const id of pemState.pending.candidatePemIds) {
      const row = await store.get(id);
      if (row && !row.deleted_at) {
        candidates.push({
          id: row.id,
          prospect_name: row.prospect_name,
          salesperson_user_id: row.salesperson_user_id,
          salesperson_display_name: row.salesperson_display_name,
          meeting_date: row.meeting_date,
          status: row.status,
          meeting_outcome: row.meeting_outcome,
          qualification: row.qualification,
          analysis_stale: row.analysis_stale,
          created_at: row.created_at,
          updated_at: row.updated_at,
          generated_at: row.generated_at,
        });
      }
    }
    const chosen = pickByDiscriminator(candidates, hint);
    if (!chosen) {
      return {
        items: [],
        clarification: `I still need you to choose: ${pemState.pending.candidateLabels.join(" or ")}?`,
        staleWarning: null,
        deterministicAnswer: null,
        answerMode: "clarification",
        diagnostics: emptyDiagnostics({
          answerMode: "clarification",
          candidateCount: candidates.length,
          requestedFields: pemState.pending.requestedFields as PemFieldKey[],
          inheritedFromConversation: true,
        }),
        nextConversationState: pemState,
      };
    }

    const fields = (
      pemState.pending.requestedFields.length
        ? pemState.pending.requestedFields
        : detectRequestedPemFields(pemState.pending.originalQuestion)
    ) as PemFieldKey[];

    return loadAndAnswer({
      recordId: chosen.id,
      fields: fields.length ? fields : ["summary"],
      inherited: true,
      explicitOverride: false,
      activeState: {
        type: "pem_active",
        activePemId: chosen.id,
        activeProspectName: chosen.prospect_name,
        lastRequestedFields: fields,
        baseProspectHint: stripDiscriminator(chosen.prospect_name),
      },
    });
  }

  // --- Active context: switch PEM ("Use Test 2") ---
  if (
    pemState.active &&
    (intent.switchPemHint ||
      (intent.intent === "pem_selection_reply" && intent.discriminator) ||
      /\b(use|go back to|switch to|actually use)\s+test\b/i.test(q))
  ) {
    const hint = intent.switchPemHint || intent.discriminator || extractDiscriminatorHint(q);
    if (hint && pemState.active.baseProspectHint) {
      const store = getPemNeatStore();
      const listed = await store.list({
        query: pemState.active.baseProspectHint,
        status: "completed",
      });
      const siblings = listed.filter(
        (r) =>
          scoreNameMatch(stripDiscriminator(r.prospect_name), pemState.active!.baseProspectHint!) >=
          60,
      );
      const chosen = pickByDiscriminator(siblings, hint);
      if (chosen) {
        const fields =
          intent.fields.length && intent.intent === "record_lookup"
            ? intent.fields
            : ((pemState.active.lastRequestedFields as PemFieldKey[]) ?? ["summary"]);
        // If the message only switches PEM without a field question, keep last field
        // unless a new field was asked in the same message ("Use Test 2. What was his budget?")
        const askedFields = detectRequestedPemFields(q);
        const resolvedFields =
          intent.intent === "record_lookup" || /\b(budget|pain|decision|type)\b/i.test(q)
            ? askedFields
            : fields;
        return loadAndAnswer({
          recordId: chosen.id,
          fields: resolvedFields.length ? resolvedFields : ["summary"],
          inherited: true,
          explicitOverride: true,
          activeState: {
            type: "pem_active",
            activePemId: chosen.id,
            activeProspectName: chosen.prospect_name,
            lastRequestedFields: resolvedFields,
            baseProspectHint: pemState.active.baseProspectHint,
          },
        });
      }
    }
  }

  if (intent.intent === "help_definition" || intent.intent === "none") {
    return none();
  }

  if (intent.intent === "pem_selection_reply" && !pemState.pending) {
    return {
      items: [],
      clarification:
        "Which prospect's PEM NEAT should I use? Please include their name (for example: Robert Vertin).",
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({ answerMode: "clarification" }),
      nextConversationState: null,
    };
  }

  // --- Record lookup ---
  let nameQuery = intent.nameQuery;
  let baseName = intent.baseName;
  let discriminator = intent.discriminator;
  let inherited = false;
  let explicitOverride = Boolean(intent.nameQuery || intent.discriminator);

  // Explicit current-message entities always win over memory.
  if (!nameQuery && !discriminator && pemState.active) {
    if (
      /\b(his|her|their|he|she|they|that|this)\b/i.test(q) ||
      q.trim().split(/\s+/).length <= 12
    ) {
      nameQuery = pemState.active.activeProspectName;
      baseName = pemState.active.baseProspectHint;
      inherited = true;
      explicitOverride = false;
    }
  }

  if (!nameQuery && input.history?.length) {
    for (let i = input.history.length - 1; i >= 0; i--) {
      const msg = input.history[i]!;
      if (msg.role !== "user") continue;
      const parsed = parsePemEntityQuery(msg.content);
      if (parsed.nameQuery) {
        nameQuery = parsed.nameQuery;
        baseName = parsed.baseName;
        if (!discriminator) discriminator = parsed.discriminator;
        inherited = true;
        break;
      }
    }
  }

  if (!nameQuery && !pemState.active) {
    return {
      items: [],
      clarification:
        "Which prospect's PEM NEAT should I use? Please include their name (for example: Robert Vertin).",
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        requestedFields: intent.fields,
      }),
      nextConversationState: null,
    };
  }

  // Explicit discriminator on known active prospect (e.g. "Robert Vertin Test 8")
  if (nameQuery && discriminator && pemState.active) {
    explicitOverride = true;
  }

  const searchQuery = baseName || nameQuery || pemState.active?.baseProspectHint || "";
  const store = getPemNeatStore();
  const listed = await store.list({ query: searchQuery, status: "completed" });
  const staleListed =
    listed.length === 0
      ? await store.list({ query: searchQuery, status: "needs_regeneration" })
      : [];
  let candidates = [...listed, ...staleListed].filter(
    (row) =>
      scoreNameMatch(row.prospect_name, searchQuery) >= 40 ||
      scoreNameMatch(stripDiscriminator(row.prospect_name), searchQuery) >= 40 ||
      (nameQuery ? scoreNameMatch(row.prospect_name, nameQuery) >= 40 : false),
  );

  // If full nameQuery includes discriminator, prefer exact-ish matches first
  if (nameQuery && discriminator) {
    const discMatches = candidates.filter((c) =>
      discriminatorMatches(c.prospect_name, discriminator!),
    );
    if (discMatches.length) candidates = discMatches;
  } else if (discriminator) {
    const discMatches = candidates.filter((c) =>
      discriminatorMatches(c.prospect_name, discriminator!),
    );
    if (discMatches.length) candidates = discMatches;
  }

  if (candidates.length === 0 && pemState.active && !explicitOverride) {
    return loadAndAnswer({
      recordId: pemState.active.activePemId,
      fields: intent.fields.length ? intent.fields : ["summary"],
      inherited: true,
      explicitOverride: false,
      activeState: pemState.active,
    });
  }

  if (candidates.length === 0) {
    return {
      items: [],
      clarification: `I couldn't find a completed PEM NEAT for ${nameQuery || searchQuery}.`,
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        detectedProspect: nameQuery,
        requestedFields: intent.fields,
      }),
      nextConversationState: pemState.active ? { pending: null, active: pemState.active } : null,
    };
  }

  // Exact full-name match wins (Robert Vertin Test 8)
  if (nameQuery) {
    const exact = candidates.filter(
      (c) => normalizeName(c.prospect_name) === normalizeName(nameQuery!),
    );
    if (exact.length === 1) {
      return loadAndAnswer({
        recordId: exact[0]!.id,
        fields: intent.fields.length ? intent.fields : ["summary"],
        inherited,
        explicitOverride: true,
        activeState: {
          type: "pem_active",
          activePemId: exact[0]!.id,
          activeProspectName: exact[0]!.prospect_name,
          lastRequestedFields: intent.fields,
          baseProspectHint: stripDiscriminator(exact[0]!.prospect_name),
        },
      });
    }
  }

  const byBase = groupByBaseName(candidates);
  if (byBase.size > 1 && !discriminator) {
    // Different people (Alex Morgan vs Alex Martinez)
    const flat = [...candidates];
    const pending: PemPendingSelection = {
      type: "pem_selection",
      originalQuestion: q,
      requestedFields: intent.fields,
      candidatePemIds: flat.map((c) => c.id),
      candidateLabels: flat.map((c) => c.prospect_name),
      baseProspectHint: baseName,
    };
    return {
      items: [],
      clarification: `I found multiple matching PEMs. Do you mean ${flat.map((c) => c.prospect_name).join(" or ")}?`,
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        detectedProspect: nameQuery,
        candidateCount: flat.length,
        requestedFields: intent.fields,
        inheritedFromConversation: inherited,
      }),
      nextConversationState: { pending, active: pemState.active },
    };
  }

  const personRows = byBase.size === 1 ? [...byBase.values()][0]! : candidates;
  personRows.sort((a, b) => {
    const da = a.meeting_date ?? a.generated_at ?? a.updated_at;
    const db = b.meeting_date ?? b.generated_at ?? b.updated_at;
    return String(db).localeCompare(String(da));
  });

  // Multiple PEMs for same person without discriminator → clarify
  if (personRows.length > 1 && !discriminator && !intent.dateHint) {
    // If active PEM already set for this person and no explicit new name, reuse it
    if (pemState.active && !explicitOverride) {
      const still = personRows.find((r) => r.id === pemState.active!.activePemId);
      if (still) {
        return loadAndAnswer({
          recordId: still.id,
          fields: intent.fields.length ? intent.fields : ["summary"],
          inherited: true,
          explicitOverride: false,
          activeState: pemState.active,
        });
      }
    }

    const pending: PemPendingSelection = {
      type: "pem_selection",
      originalQuestion: q,
      requestedFields: intent.fields,
      candidatePemIds: personRows.map((r) => r.id),
      candidateLabels: personRows.map((r) => r.prospect_name),
      baseProspectHint: stripDiscriminator(personRows[0]!.prospect_name),
    };
    return {
      items: [],
      clarification: `I found multiple matching PEMs. Do you mean ${personRows.map((r) => r.prospect_name).join(" or ")}?`,
      staleWarning: null,
      deterministicAnswer: null,
      answerMode: "clarification",
      diagnostics: emptyDiagnostics({
        answerMode: "clarification",
        detectedProspect: stripDiscriminator(personRows[0]!.prospect_name),
        candidateCount: personRows.length,
        requestedFields: intent.fields,
        inheritedFromConversation: inherited,
      }),
      nextConversationState: { pending, active: null },
    };
  }

  let chosen = personRows[0]!;
  if (discriminator) {
    chosen = pickByDiscriminator(personRows, discriminator) ?? chosen;
  }
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

  return loadAndAnswer({
    recordId: chosen.id,
    fields: intent.fields.length ? intent.fields : ["summary"],
    staleNote:
      personRows.length > 1 && intent.wantsLatest && !discriminator
        ? `Using ${chosen.prospect_name}'s most recent PEM from ${formatMeetingDate(chosen.meeting_date)}.`
        : null,
    inherited,
    explicitOverride,
    activeState: {
      type: "pem_active",
      activePemId: chosen.id,
      activeProspectName: chosen.prospect_name,
      lastRequestedFields: intent.fields,
      baseProspectHint: stripDiscriminator(chosen.prospect_name),
    },
  });
}
