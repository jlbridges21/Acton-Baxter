/**
 * PP# (progress payment) milestone mapping — pure configuration and matching.
 *
 * Acton has no confirmed business rule yet for which invoices are progress payments or how
 * they tie to schedule milestones, so nothing here is hardcoded. An administrator configures:
 *   1. classification — which invoices are PP# invoices and where the PP identifier lives
 *      (a document custom field, or a pattern on the invoice name or number)
 *   2. milestone %    — where the milestone percentage lives (a field or a pattern), optional
 *   3. link           — how an invoice is tied to a JobTread task: a document field holding the
 *      task id, or a task-name pattern matched within the *same job* (stable job id)
 *   4. approval       — suggested links stay out of reports until approved, unless the admin
 *      allows unique matches to be accepted automatically
 *
 * The preview lists every ambiguous and unmatched invoice; nothing is ever picked silently.
 */

import { z } from "zod";

const pattern = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((p) => safeRegex(p) !== null, "That pattern isn't a valid regular expression.");
const fieldId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{4,80}$/, "Use a JobTread custom field id.");

export const ppConfigSchema = z.object({
  classification: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("document_field"), fieldId }),
      z.object({ mode: z.literal("name_pattern"), pattern }),
      z.object({ mode: z.literal("number_pattern"), pattern }),
    ])
    .default({ mode: "none" }),
  milestonePct: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("document_field"), fieldId }),
      z.object({ mode: z.literal("name_pattern"), pattern }),
    ])
    .default({ mode: "none" }),
  link: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("manual_only") }),
      z.object({ mode: z.literal("document_field_task_id"), fieldId }),
      z.object({
        mode: z.literal("task_name_pattern"),
        /** Task-name template; {pp} is replaced by the invoice's PP identifier. */
        template: z.string().trim().min(1).max(120).includes("{pp}", {
          message: "The task-name template must contain {pp}.",
        }),
        scope: z.enum(["milestone_groups", "all_tasks"]).default("milestone_groups"),
      }),
    ])
    .default({ mode: "none" }),
  autoAcceptUnique: z.boolean().default(false),
});
export type PpConfig = z.infer<typeof ppConfigSchema>;

export const DEFAULT_PP_CONFIG: PpConfig = ppConfigSchema.parse({});

/** Compile an admin pattern case-insensitively, or null when invalid. */
export function safeRegex(p: string): RegExp | null {
  if (p.length > 200) return null;
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}

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
};

export type PpLinkRow = {
  document_id: string;
  task_id: string | null;
  job_id: string | null;
  pp_number: string | null;
  milestone_pct: number | string | null;
  match_method: "rule" | "manual";
  status: "suggested" | "approved" | "rejected";
};

/** Pattern capture: the first capture group, else the whole match. */
function capture(re: RegExp, text: string | null): string | null {
  if (!text) return null;
  const m = re.exec(text.slice(0, 300));
  if (!m) return null;
  return (m[1] ?? m[0]).trim() || null;
}

export function classifyDocument(doc: PpDocument, config: PpConfig): string | null {
  if (doc.type !== "customerInvoice") return null;
  const c = config.classification;
  if (c.mode === "none") return null;
  if (c.mode === "document_field") return doc.fields?.[c.fieldId]?.[0]?.trim() || null;
  const re = safeRegex(c.pattern);
  if (!re) return null;
  return capture(re, c.mode === "name_pattern" ? doc.name : doc.number);
}

export function milestonePctOf(doc: PpDocument, config: PpConfig): number | null {
  const m = config.milestonePct;
  if (m.mode === "none") return null;
  const raw =
    m.mode === "document_field"
      ? (doc.fields?.[m.fieldId]?.[0] ?? null)
      : (() => {
          const re = safeRegex(m.pattern);
          return re ? capture(re, doc.name) : null;
        })();
  if (raw === null) return null;
  const n = Number(String(raw).replace(/[%\s,]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export type MatchResult =
  | { status: "matched"; taskId: string; via: string }
  | { status: "ambiguous"; candidates: Array<{ id: string; name: string | null }> }
  | { status: "unmatched"; reason: string };

/** Candidate tasks for one classified invoice, by stable ids only. */
export function matchTask(
  doc: PpDocument,
  pp: string,
  config: PpConfig,
  tasksByJob: Map<string, PpTask[]>,
  tasksById: Map<string, PpTask>,
): MatchResult {
  const link = config.link;
  if (link.mode === "none" || link.mode === "manual_only")
    return { status: "unmatched", reason: "Links are set manually (no automatic rule)." };
  if (!doc.job_id) return { status: "unmatched", reason: "The invoice isn't on a job." };
  if (link.mode === "document_field_task_id") {
    const id = doc.fields?.[link.fieldId]?.[0]?.trim();
    if (!id) return { status: "unmatched", reason: "The task-id field is blank on this invoice." };
    const task = tasksById.get(id);
    if (!task) return { status: "unmatched", reason: `Task ${id} isn't in the synced tasks.` };
    if (task.job_id !== doc.job_id)
      return { status: "unmatched", reason: `Task ${id} belongs to a different job.` };
    return { status: "matched", taskId: id, via: "document field (task id)" };
  }
  const expected = new RegExp(
    `^\\s*${link.template.split("{pp}").map(escapeRegex).join(escapeRegex(pp))}\\s*$`,
    "i",
  );
  const pool = (tasksByJob.get(doc.job_id) ?? []).filter(
    (t) => link.scope === "all_tasks" || t.is_group === true,
  );
  const hits = pool.filter((t) => t.name && expected.test(t.name));
  if (hits.length === 1) return { status: "matched", taskId: hits[0]!.id, via: "task name" };
  if (hits.length > 1)
    return { status: "ambiguous", candidates: hits.map((t) => ({ id: t.id, name: t.name })) };
  return {
    status: "unmatched",
    reason: `No ${link.scope === "all_tasks" ? "task" : "milestone group"} on this job is named "${link.template.replace("{pp}", pp)}".`,
  };
}

export type PreviewItem = {
  documentId: string;
  number: string | null;
  name: string | null;
  jobId: string | null;
  pp: string;
  milestonePct: number | null;
  match: MatchResult;
  link: PpLinkRow | null;
};

export type PpPreview = {
  configured: boolean;
  invoices: number;
  classified: number;
  notClassified: number;
  matched: number;
  ambiguous: PreviewItem[];
  unmatched: PreviewItem[];
  matchedItems: PreviewItem[];
  approved: number;
  rejected: number;
  pendingApproval: number;
};

/** Match-count preview for a configuration (no writes). */
export function previewPpMatches(
  docs: PpDocument[],
  tasks: PpTask[],
  links: PpLinkRow[],
  config: PpConfig,
): PpPreview {
  const tasksByJob = new Map<string, PpTask[]>();
  for (const t of tasks)
    if (t.job_id) tasksByJob.set(t.job_id, [...(tasksByJob.get(t.job_id) ?? []), t]);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const linkByDoc = new Map(links.map((l) => [l.document_id, l]));
  const invoices = docs.filter((d) => d.type === "customerInvoice");
  const items: PreviewItem[] = [];
  for (const doc of invoices) {
    const pp = classifyDocument(doc, config);
    if (!pp) continue;
    items.push({
      documentId: doc.id,
      number: doc.number,
      name: doc.name,
      jobId: doc.job_id,
      pp,
      milestonePct: milestonePctOf(doc, config),
      match: matchTask(doc, pp, config, tasksByJob, tasksById),
      link: linkByDoc.get(doc.id) ?? null,
    });
  }
  const matchedItems = items.filter((i) => i.match.status === "matched");
  return {
    configured: config.classification.mode !== "none",
    invoices: invoices.length,
    classified: items.length,
    notClassified: invoices.length - items.length,
    matched: matchedItems.length,
    ambiguous: items.filter((i) => i.match.status === "ambiguous"),
    unmatched: items.filter((i) => i.match.status === "unmatched"),
    matchedItems,
    approved: links.filter((l) => l.status === "approved").length,
    rejected: links.filter((l) => l.status === "rejected").length,
    pendingApproval: links.filter((l) => l.status === "suggested").length,
  };
}

/**
 * Links a report may use: approved links always; suggested rule matches only when the admin
 * allows unique matches to be accepted automatically. Rejected links are never used.
 */
export function effectiveLinks(links: PpLinkRow[], config: PpConfig): Map<string, PpLinkRow> {
  const out = new Map<string, PpLinkRow>();
  for (const l of links) {
    if (l.status === "approved" || (l.status === "suggested" && config.autoAcceptUnique))
      out.set(l.document_id, l);
  }
  return out;
}

export type DrillLevel = {
  key: "project" | "milestone" | "invoice" | "payments";
  label: string;
  enabled: boolean;
  reason: string | null;
};

/** Project → PP# Milestone → Invoice → Payments; each level only when its join is verified. */
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
      key: "milestone",
      label: "PP# milestone",
      enabled: input.tasksSynced && input.ppConfigured && input.approvedLinks > 0,
      reason: !input.ppConfigured
        ? "PP# mapping isn't configured (Reports → Data settings → Financial data → PP# mapping)."
        : !input.tasksSynced
          ? "Tasks haven't synced."
          : input.approvedLinks === 0
            ? "No invoice-to-milestone links are approved yet."
            : null,
    },
    {
      key: "invoice",
      label: "Invoice",
      enabled: input.documentsSynced,
      reason: input.documentsSynced ? null : "Financial documents haven't synced.",
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
