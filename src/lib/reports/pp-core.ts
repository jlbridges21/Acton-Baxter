/**
 * PP# (progress payment PP#1–PP#10) milestone mapping — pure configuration and matching.
 *
 * Acton has no confirmed rule for which invoices are progress payments or how they tie to
 * schedule tasks, so nothing is hardcoded. An administrator configures:
 *   1. classification — which customer invoices are PP# invoices and how the PP number (1–10)
 *      is read: a pattern on the invoice name or number (capture group 1 = the number), or a
 *      document custom field. Other document types are never classified.
 *   2. link — how an invoice ties to a JobTread task in the *same job*: a document field that
 *      holds the task id (checked first when set), and/or a task-name template such as
 *      "PP#{pp}:". Never across jobs.
 *   3. percentages — the standard PP#1–10 split (must total 100%) and labelled per-project
 *      overrides. Percentages never change invoice amounts or imply payment status.
 *   4. approval — suggested links stay out of verified reporting until an administrator
 *      approves them, unless autoAcceptUnique is turned on.
 *
 * Text matching (documented, deterministic): names are trimmed and runs of whitespace are
 * collapsed to one space; matching is case-insensitive unless caseSensitive is true.
 */

import { z } from "zod";

export const PP_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const PP_CONFIG_SCHEMA_VERSION = 2;

/** Why an admin pattern is unsafe or unusable, or null when it's fine. */
export function regexProblem(p: string): string | null {
  if (!p.trim()) return "Enter a pattern.";
  if (p.length > 200) return "Keep the pattern under 200 characters.";
  if (/\\[1-9]|\\k</.test(p)) return "Back-references aren't allowed.";
  // Nested quantifiers such as (a+)+ or (.*)* can take exponential time (ReDoS).
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]/.test(p))
    return "Nested repetition like (a+)+ isn't allowed (it can hang on long names).";
  let re: RegExp;
  try {
    re = new RegExp(p, "i");
  } catch (error) {
    return `Not a valid regular expression: ${error instanceof Error ? error.message : "syntax error"}.`;
  }
  // Count capturing groups by matching the empty alternation trick.
  const groups = new RegExp(`${re.source}|`).exec("")!.length - 1;
  if (groups < 1) return "Add a capturing group around the PP number, e.g. PP#(10|[1-9])\\b.";
  return null;
}

const regex = z.string({ error: "Required" }).superRefine((p, ctx) => {
  const problem = regexProblem(p);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});
const fieldId = z
  .string({ error: "Required" })
  .trim()
  .regex(/^[A-Za-z0-9_-]{4,80}$/, "Use a JobTread custom field id (4–80 letters, digits, - or _).");

export const classificationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("name_pattern"),
    regex,
    /** Read when the name doesn't match (e.g. "Progress Invoice"). Never the document number. */
    fallbackFieldId: fieldId.nullable().optional(),
  }),
  z.object({ mode: z.literal("number_pattern"), regex }),
  z.object({ mode: z.literal("document_field"), fieldId }),
]);

export const linkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("manual_only") }),
  z.object({ mode: z.literal("document_field_task_id"), fieldId }),
  z.object({
    mode: z.literal("task_name_pattern"),
    /** Rendered with the PP number; a task matches when its name starts with it. */
    template: z
      .string({ error: "Required" })
      .trim()
      .min(1, "Required")
      .max(120)
      .refine((t) => t.includes("{pp}"), "Must contain {pp}, e.g. PP#{pp}:"),
    scope: z.enum(["all_tasks", "milestone_groups"]).default("all_tasks"),
    /** Checked before the template when set: a document field holding the JobTread task id. */
    directFieldId: fieldId.nullable().optional(),
  }),
]);

const split = z
  .record(z.string(), z.number({ error: "Enter a number" }).min(0).max(100))
  .superRefine((s, ctx) => {
    for (const n of PP_NUMBERS)
      if (typeof s[String(n)] !== "number")
        ctx.addIssue({ code: "custom", path: [String(n)], message: `PP#${n} needs a percentage.` });
    const extra = Object.keys(s).filter((k) => !PP_NUMBERS.map(String).includes(k));
    if (extra.length)
      ctx.addIssue({
        code: "custom",
        message: `Only PP#1–PP#10 are allowed (found ${extra.join(", ")}).`,
      });
    const total = PP_NUMBERS.reduce((t, n) => t + (s[String(n)] ?? 0), 0);
    if (Math.abs(total - 100) > 0.01)
      ctx.addIssue({
        code: "custom",
        message: `Percentages must total 100% (they total ${Math.round(total * 100) / 100}%).`,
      });
  });

export const DEFAULT_SPLIT: Record<string, number> = Object.fromEntries(
  PP_NUMBERS.map((n) => [String(n), 10]),
);

export const ppConfigSchema = z.object({
  schemaVersion: z.literal(PP_CONFIG_SCHEMA_VERSION).default(PP_CONFIG_SCHEMA_VERSION),
  caseSensitive: z.boolean().default(false),
  classification: classificationSchema.default({ mode: "none" }),
  link: linkSchema.default({ mode: "none" }),
  percentages: z
    .object({
      standard: split.default(DEFAULT_SPLIT),
      overrides: z
        .array(
          z.object({
            jobId: z.string({ error: "Required" }).trim().min(1, "Required").max(80),
            split,
            note: z.string().max(200).nullable().optional(),
          }),
        )
        .max(500)
        .default([]),
    })
    .default({ standard: DEFAULT_SPLIT, overrides: [] }),
  autoAcceptUnique: z.boolean().default(false),
});
export type PpConfig = z.infer<typeof ppConfigSchema>;

export const DEFAULT_PP_CONFIG: PpConfig = ppConfigSchema.parse({});

const MODES: Record<string, string[]> = {
  classification: ["none", "name_pattern", "number_pattern", "document_field"],
  link: ["none", "manual_only", "document_field_task_id", "task_name_pattern"],
};

/**
 * Bring older or hand-written configs to the current shape before validating:
 *   - classification.pattern (schema v1) → classification.regex
 *   - milestonePct (schema v1) is superseded by percentages and dropped (reported as a note)
 */
export function normalizePpConfig(raw: unknown): { value: unknown; notes: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, notes: [] };
  const notes: string[] = [];
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const c = out.classification as Record<string, unknown> | undefined;
  if (c && typeof c === "object" && c.regex === undefined && typeof c.pattern === "string") {
    const { pattern, ...rest } = c;
    out.classification = { ...rest, regex: pattern };
    notes.push("classification.pattern was renamed to classification.regex.");
  }
  if ("milestonePct" in out) {
    delete out.milestonePct;
    notes.push("milestonePct was replaced by percentages (PP#1–PP#10 split).");
  }
  if (out.schemaVersion === 1) out.schemaVersion = PP_CONFIG_SCHEMA_VERSION;
  return { value: out, notes };
}

export type PpFieldError = { path: string; message: string };

/** Validate a config and explain every problem by its field path (mode-aware wording). */
export function validatePpConfig(
  raw: unknown,
):
  | { ok: true; config: PpConfig; notes: string[] }
  | { ok: false; errors: PpFieldError[]; notes: string[] } {
  const { value, notes } = normalizePpConfig(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      ok: false,
      errors: [{ path: "", message: "The configuration must be a JSON object." }],
      notes,
    };
  const parsed = ppConfigSchema.safeParse(value);
  if (parsed.success) return { ok: true, config: parsed.data, notes };
  const v = value as Record<string, Record<string, unknown> | undefined>;
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    const [section, key] = issue.path.map(String);
    const mode =
      section && v[section] && typeof v[section] === "object" ? v[section]!.mode : undefined;
    if (
      section &&
      MODES[section] &&
      (key === "mode" || (key === undefined && !MODES[section]!.includes(String(mode))))
    )
      return {
        path: `${section}.mode`,
        message: `Must be one of ${MODES[section]!.join(", ")}${mode === undefined ? "" : ` (got "${String(mode)}")`}.`,
      };
    if (issue.message === "Required" || /received undefined/.test(issue.message))
      return {
        path,
        message: mode ? `Required when ${section}.mode is ${String(mode)}.` : "Required.",
      };
    return { path, message: issue.message };
  });
  return { ok: false, errors, notes };
}

const normText = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type PpDocument = {
  id: string;
  job_id: string | null;
  type: string;
  number: string | null;
  name: string | null;
  fields?: Record<string, string[]> | null;
};

export type PpTask = {
  id: string;
  job_id: string | null;
  name: string | null;
  is_group: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type PpLinkRow = {
  document_id: string;
  task_id: string | null;
  job_id: string | null;
  pp_number: string | null;
  milestone_pct: number | string | null;
  classification_method?: "rule" | "manual";
  match_method: "rule" | "manual";
  status: "suggested" | "approved" | "rejected";
  config_version?: number | null;
  conflict?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  note?: string | null;
};

export type Classification =
  | { status: "classified"; pp: number; source: string }
  | { status: "ambiguous"; values: string[]; source: string }
  | { status: "unclassified"; reason: string };

const toPp = (raw: string | null | undefined): number | null => {
  const t = (raw ?? "").trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 10 ? n : null;
};

/** Every distinct capture-group-1 value of a pattern in a text. */
function captures(pattern: string, text: string, caseSensitive: boolean): string[] {
  const re = new RegExp(pattern, caseSensitive ? "g" : "gi");
  const out = new Set<string>();
  const input = normText(text).slice(0, 300);
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(input)) && guard++ < 20) {
    out.add((m[1] ?? m[0]).trim());
    if (m[0] === "") re.lastIndex++;
  }
  return [...out];
}

/** The PP number of a customer invoice under a config. Other types are never classified. */
export function classifyInvoice(doc: PpDocument, config: PpConfig): Classification {
  if (doc.type !== "customerInvoice")
    return { status: "unclassified", reason: "Not a customer invoice." };
  const c = config.classification;
  if (c.mode === "none")
    return { status: "unclassified", reason: "No classification rule is configured." };
  const fromField = (id: string, source: string): Classification | null => {
    const vals = (doc.fields?.[id] ?? []).map((v) => v.trim()).filter(Boolean);
    if (!vals.length) return null;
    const nums = [...new Set(vals.map(toPp))];
    if (nums.length > 1) return { status: "ambiguous", values: vals, source };
    return nums[0]
      ? { status: "classified", pp: nums[0], source }
      : {
          status: "unclassified",
          reason: `${source} "${vals[0]}" isn't a PP number from 1 to 10.`,
        };
  };
  if (c.mode === "document_field")
    return (
      fromField(c.fieldId, "document field") ?? {
        status: "unclassified",
        reason: "The PP# field is blank on this invoice.",
      }
    );
  if (regexProblem(c.regex)) return { status: "unclassified", reason: "The pattern is invalid." };
  const source = c.mode === "name_pattern" ? "invoice name" : "invoice number";
  const vals = captures(
    c.regex,
    (c.mode === "name_pattern" ? doc.name : doc.number) ?? "",
    config.caseSensitive,
  );
  if (vals.length > 1) return { status: "ambiguous", values: vals, source };
  if (vals.length === 1) {
    const pp = toPp(vals[0]);
    return pp
      ? { status: "classified", pp, source }
      : {
          status: "unclassified",
          reason: `Matched "${vals[0]}", which isn't a PP number from 1 to 10.`,
        };
  }
  if (c.mode === "name_pattern" && c.fallbackFieldId) {
    const f = fromField(c.fallbackFieldId, "fallback field");
    if (f) return f;
  }
  return {
    status: "unclassified",
    reason: `The ${source} doesn't match the pattern; classify it manually.`,
  };
}

/** Back-compat helper: the PP number as text, or null. */
export function classifyDocument(doc: PpDocument, config: PpConfig): string | null {
  const c = classifyInvoice(doc, config);
  return c.status === "classified" ? String(c.pp) : null;
}

/** The milestone % for a PP number on a job: a labelled project override, else the standard split. */
export function milestonePercent(config: PpConfig, pp: number | null, jobId: string | null) {
  if (!pp) return { pct: null, source: null as null | "standard" | "project override" };
  const override = jobId ? config.percentages.overrides.find((o) => o.jobId === jobId) : undefined;
  if (override)
    return { pct: override.split[String(pp)] ?? null, source: "project override" as const };
  return { pct: config.percentages.standard[String(pp)] ?? null, source: "standard" as const };
}

export type MatchResult =
  | { status: "matched"; taskId: string; via: string }
  | { status: "ambiguous"; candidates: Array<{ id: string; name: string | null }> }
  | { status: "unmatched"; reason: string };

/** Does a task name start with the rendered template (and not continue with a digit)? */
export function templateMatches(
  template: string,
  pp: number,
  taskName: string | null,
  caseSensitive = false,
) {
  const rendered = normText(template.split("{pp}").join(String(pp)));
  const re = new RegExp(`^${escapeRegex(rendered)}(?!\\d)`, caseSensitive ? "" : "i");
  return re.test(normText(taskName));
}

/** The task for one classified invoice — same job id only; a direct field wins when set. */
export function matchTask(
  doc: PpDocument,
  pp: number,
  config: PpConfig,
  tasksByJob: Map<string, PpTask[]>,
  tasksById: Map<string, PpTask>,
): MatchResult {
  const link = config.link;
  if (link.mode === "none" || link.mode === "manual_only")
    return { status: "unmatched", reason: "Links are assigned manually (no automatic rule)." };
  if (!doc.job_id) return { status: "unmatched", reason: "The invoice isn't on a job." };
  const direct = link.mode === "document_field_task_id" ? link.fieldId : link.directFieldId;
  if (direct) {
    const id = doc.fields?.[direct]?.[0]?.trim();
    if (id) {
      const task = tasksById.get(id);
      if (!task)
        return {
          status: "unmatched",
          reason: `Task ${id} (from the invoice field) isn't in the synced tasks.`,
        };
      if (task.job_id !== doc.job_id)
        return { status: "unmatched", reason: `Task ${id} belongs to a different project.` };
      return { status: "matched", taskId: id, via: "document field (task id)" };
    }
    if (link.mode === "document_field_task_id")
      return { status: "unmatched", reason: "The task-id field is blank on this invoice." };
  }
  if (link.mode !== "task_name_pattern") return { status: "unmatched", reason: "No task rule." };
  const pool = (tasksByJob.get(doc.job_id) ?? []).filter(
    (t) => link.scope === "all_tasks" || t.is_group === true,
  );
  const hits = pool.filter((t) => templateMatches(link.template, pp, t.name, config.caseSensitive));
  if (hits.length === 1) return { status: "matched", taskId: hits[0]!.id, via: "task name" };
  if (hits.length > 1)
    return { status: "ambiguous", candidates: hits.map((t) => ({ id: t.id, name: t.name })) };
  return {
    status: "unmatched",
    reason: `No ${link.scope === "all_tasks" ? "task" : "milestone group"} in this project starts with "${link.template.replace("{pp}", String(pp))}".`,
  };
}

export type PreviewItem = {
  documentId: string;
  number: string | null;
  name: string | null;
  jobId: string | null;
  jobName: string | null;
  classification: Classification;
  pp: number | null;
  milestonePct: number | null;
  milestonePctSource: "standard" | "project override" | null;
  match: MatchResult | null;
  link: PpLinkRow | null;
};

export type PpPreview = {
  configured: boolean;
  inspected: number;
  classified: number;
  unclassified: PreviewItem[];
  ambiguousClassification: PreviewItem[];
  matched: PreviewItem[];
  ambiguous: PreviewItem[];
  unmatched: PreviewItem[];
  byNumber: Record<string, number>;
  approved: number;
  rejected: number;
  pendingApproval: number;
  conflicts: number;
};

/** Read-only match preview for a configuration over the synced invoices and tasks. */
export function previewPpMatches(
  docs: PpDocument[],
  tasks: PpTask[],
  links: PpLinkRow[],
  config: PpConfig,
  jobNames: Map<string, string> = new Map(),
): PpPreview {
  const tasksByJob = new Map<string, PpTask[]>();
  for (const t of tasks)
    if (t.job_id) tasksByJob.set(t.job_id, [...(tasksByJob.get(t.job_id) ?? []), t]);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const linkByDoc = new Map(links.map((l) => [l.document_id, l]));
  const invoices = docs.filter((d) => d.type === "customerInvoice");
  const items: PreviewItem[] = invoices.map((doc) => {
    const classification = classifyInvoice(doc, config);
    const pp = classification.status === "classified" ? classification.pp : null;
    const pct = milestonePercent(config, pp, doc.job_id);
    return {
      documentId: doc.id,
      number: doc.number,
      name: doc.name,
      jobId: doc.job_id,
      jobName: doc.job_id ? (jobNames.get(doc.job_id) ?? null) : null,
      classification,
      pp,
      milestonePct: pct.pct,
      milestonePctSource: pct.source,
      match: pp ? matchTask(doc, pp, config, tasksByJob, tasksById) : null,
      link: linkByDoc.get(doc.id) ?? null,
    };
  });
  const classified = items.filter((i) => i.pp !== null);
  const byNumber: Record<string, number> = {};
  for (const i of classified) byNumber[String(i.pp)] = (byNumber[String(i.pp)] ?? 0) + 1;
  return {
    configured: config.classification.mode !== "none",
    inspected: invoices.length,
    classified: classified.length,
    unclassified: items.filter((i) => i.classification.status === "unclassified"),
    ambiguousClassification: items.filter((i) => i.classification.status === "ambiguous"),
    matched: classified.filter((i) => i.match?.status === "matched"),
    ambiguous: classified.filter((i) => i.match?.status === "ambiguous"),
    unmatched: classified.filter((i) => i.match?.status === "unmatched"),
    byNumber,
    approved: links.filter((l) => l.status === "approved").length,
    rejected: links.filter((l) => l.status === "rejected").length,
    pendingApproval: links.filter((l) => l.status === "suggested").length,
    conflicts: links.filter((l) => l.conflict).length,
  };
}

/**
 * Links reports may treat as verified: approved links always; suggested rule matches only
 * when the admin allows unique matches to be accepted automatically. Rejected links never.
 */
export function effectiveLinks(links: PpLinkRow[], config: PpConfig): Map<string, PpLinkRow> {
  const out = new Map<string, PpLinkRow>();
  for (const l of links)
    if (l.status === "approved" || (l.status === "suggested" && config.autoAcceptUnique))
      out.set(l.document_id, l);
  return out;
}

/**
 * Re-check stored links against a (new) config and the synced data. Never changes a decision:
 * a link that no longer agrees gets a conflict note; one that agrees again has it cleared.
 */
export function revalidateLinks(
  links: PpLinkRow[],
  docs: PpDocument[],
  tasks: PpTask[],
  config: PpConfig,
): Array<{ documentId: string; conflict: string | null }> {
  const docById = new Map(docs.map((d) => [d.id, d]));
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const tasksByJob = new Map<string, PpTask[]>();
  for (const t of tasks)
    if (t.job_id) tasksByJob.set(t.job_id, [...(tasksByJob.get(t.job_id) ?? []), t]);
  return links
    .filter((l) => l.status !== "rejected")
    .map((l) => {
      const doc = docById.get(l.document_id);
      let conflict: string | null = null;
      if (!doc) conflict = "The invoice is no longer in the synced JobTread data.";
      else if (doc.job_id !== l.job_id)
        conflict = "The invoice moved to a different project in JobTread.";
      else if (l.task_id && !tasksById.has(l.task_id))
        conflict = "The linked task is no longer in the synced tasks.";
      else if (l.task_id && tasksById.get(l.task_id)!.job_id !== doc.job_id)
        conflict = "The linked task is in a different project.";
      else if (l.classification_method !== "manual") {
        const c = classifyInvoice(doc, config);
        if (c.status !== "classified")
          conflict = "The current rule no longer classifies this invoice.";
        else if (String(c.pp) !== String(l.pp_number))
          conflict = `The current rule reads PP#${c.pp}, but the link says PP#${l.pp_number}.`;
        else if (l.match_method === "rule") {
          const m = matchTask(doc, c.pp, config, tasksByJob, tasksById);
          if (m.status === "matched" && m.taskId !== l.task_id)
            conflict = "The current rule matches a different task.";
          else if (m.status !== "matched")
            conflict = "The current rule no longer matches a single task.";
        }
      }
      return { documentId: l.document_id, conflict };
    });
}

export type DrillLevel = {
  key: "project" | "pp" | "invoice" | "task" | "payments";
  label: string;
  enabled: boolean;
  reason: string | null;
};

/** Project → PP# → Invoice → Task (→ Payments); each level only when its join is verified. */
export function drillLevels(input: {
  tasksSynced: boolean;
  documentsSynced: boolean;
  paymentsSynced: boolean;
  approvedLinks: number;
  ppConfigured: boolean;
}): DrillLevel[] {
  return [
    { key: "project", label: "Project", enabled: true, reason: null },
    {
      key: "pp",
      label: "PP#",
      enabled: input.ppConfigured || input.approvedLinks > 0,
      reason:
        input.ppConfigured || input.approvedLinks > 0
          ? null
          : "PP# classification isn't configured (Reports → Data settings → Financial data → PP# mapping).",
    },
    {
      key: "invoice",
      label: "Invoice",
      enabled: input.documentsSynced,
      reason: input.documentsSynced ? null : "Financial documents haven't synced.",
    },
    {
      key: "task",
      label: "Milestone task",
      enabled: input.tasksSynced && input.approvedLinks > 0,
      reason: !input.tasksSynced
        ? "Tasks haven't synced."
        : input.approvedLinks === 0
          ? "No invoice-to-task links are approved yet."
          : null,
    },
    {
      key: "payments",
      label: "Payments",
      enabled: input.paymentsSynced,
      reason: input.paymentsSynced
        ? null
        : "Payment sync is off or hasn't succeeded, so payments can't be listed.",
    },
  ];
}
