import { z } from "zod";

const speakerSchema = z.enum(["customer", "advisor", "unknown"]).catch("unknown");
const confidenceSchema = z.enum(["high", "medium", "low", "unknown"]).catch("medium");

/** Single provenance-aware fact in the internal Fact Ledger (not final NEAT). */
export const factLedgerItemSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const summary = value.trim();
      return summary ? { summary, speaker: "unknown", confidence: "medium" } : null;
    }
    return value;
  },
  z
    .object({
      summary: z.string().min(1),
      speaker: speakerSchema.optional().default("unknown"),
      timestamp: z.string().nullable().optional(),
      sourceHint: z.string().nullable().optional(),
      factType: z.string().nullable().optional(),
      confidence: confidenceSchema.optional().default("medium"),
    })
    .nullable()
    .catch(null),
);

export const budgetLedgerItemSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const summary = value.trim();
      return summary ? { summary, confidence: "medium" } : null;
    }
    return value;
  },
  z
    .object({
      summary: z.string().min(1),
      amount: z.string().nullable().optional(),
      speaker: speakerSchema.optional().default("unknown"),
      meaning: z.string().nullable().optional(),
      scope: z.string().nullable().optional(),
      confidence: confidenceSchema.optional().default("medium"),
      timestamp: z.string().nullable().optional(),
      sourceHint: z.string().nullable().optional(),
    })
    .nullable()
    .catch(null),
);

function itemArray(schema: z.ZodTypeAny) {
  return z.preprocess(
    (value) => {
      if (!Array.isArray(value)) return value == null ? [] : [value];
      return value;
    },
    z.array(schema).transform((items) => items.filter((i) => i != null)),
  );
}

/**
 * Internal Fact Ledger — richer than the final NEAT.
 * Code owns final NEAT scaffolding; the model fills information here.
 */
export const factLedgerSchema = z.object({
  customerContext: itemArray(factLedgerItemSchema).default([]),
  project: itemArray(factLedgerItemSchema).default([]),
  motivation: itemArray(factLedgerItemSchema).default([]),
  partnerConcerns: itemArray(factLedgerItemSchema).default([]),
  budget: itemArray(budgetLedgerItemSchema).default([]),
  decision: itemArray(factLedgerItemSchema).default([]),
  schedule: itemArray(factLedgerItemSchema).default([]),
  commitments: itemArray(factLedgerItemSchema).default([]),
  nextSteps: itemArray(factLedgerItemSchema).default([]),
  pemProcessEvidence: itemArray(factLedgerItemSchema).default([]),
  limitations: z.array(z.string()).catch([]).default([]),
});

export type FactLedger = z.infer<typeof factLedgerSchema>;
export type FactLedgerItem = NonNullable<z.infer<typeof factLedgerItemSchema>>;

export function emptyFactLedger(): FactLedger {
  return factLedgerSchema.parse({});
}

export function parseFactLedger(raw: unknown): FactLedger {
  return factLedgerSchema.parse(raw);
}

export function tryParseFactLedger(raw: unknown): {
  ok: boolean;
  ledger: FactLedger;
  issues: string[];
} {
  const parsed = factLedgerSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, ledger: parsed.data, issues: [] };
  }
  // Salvage: if top-level keys exist, coerce via parse with catch defaults where possible
  try {
    const salvage = factLedgerSchema.parse(raw && typeof raw === "object" ? raw : {});
    return {
      ok: false,
      ledger: salvage,
      issues: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  } catch {
    return {
      ok: false,
      ledger: emptyFactLedger(),
      issues: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
}

export function countFactLedgerItems(ledger: FactLedger): number {
  return (
    ledger.customerContext.length +
    ledger.project.length +
    ledger.motivation.length +
    ledger.partnerConcerns.length +
    ledger.budget.length +
    ledger.decision.length +
    ledger.schedule.length +
    ledger.commitments.length +
    ledger.nextSteps.length +
    ledger.pemProcessEvidence.length
  );
}

export function mergeFactLedgers(parts: FactLedger[]): FactLedger {
  if (parts.length === 0) return emptyFactLedger();
  if (parts.length === 1) return parts[0]!;
  const merged = emptyFactLedger();
  const keys = [
    "customerContext",
    "project",
    "motivation",
    "partnerConcerns",
    "budget",
    "decision",
    "schedule",
    "commitments",
    "nextSteps",
    "pemProcessEvidence",
  ] as const;
  for (const part of parts) {
    for (const key of keys) {
      merged[key] = [...merged[key], ...part[key]] as never;
    }
    merged.limitations = [...merged.limitations, ...part.limitations];
  }
  // Dedupe by summary (case-insensitive)
  for (const key of keys) {
    const seen = new Set<string>();
    merged[key] = (merged[key] as FactLedgerItem[]).filter((item) => {
      const k = item.summary.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    }) as never;
  }
  merged.limitations = [...new Set(merged.limitations.map((l) => l.trim()).filter(Boolean))];
  return merged;
}
