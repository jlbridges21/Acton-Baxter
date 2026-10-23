/**
 * Report planning sessions: Dexter's structured memory of a report request.
 *
 * One session per conversation thread (a user's draft thread, or a user + report). Dexter
 * reads it at the start of every turn and updates it through the reports_plan tool, so
 * answers are never asked for twice and long requests survive leaving the page.
 */

import "server-only";

import { z } from "zod";
import { agentDb, eq } from "@/lib/agents/store";

const text = (max = 600) => z.string().trim().max(max);

export const questionSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,40}$/),
  question: text(400).min(1),
  why: text(300).optional(),
  options: z.array(text(120)).max(6).optional(),
  status: z.enum(["open", "answered", "dismissed"]).default("open"),
  answer: text(600).optional(),
});

export const planItemSchema = z.object({
  title: text(120).min(1),
  kind: text(40).optional(),
  status: z.enum(["ready", "building", "awaiting_clarification", "unavailable", "done"]),
  note: text(300).optional(),
});

export const requirementsSchema = z.object({
  goal: text(600).optional(),
  audience: text(200).optional(),
  dataSources: z.array(text(200)).max(12).optional(),
  metrics: z.array(text(300)).max(20).optional(),
  calculations: z.array(text(400)).max(15).optional(),
  filters: z.array(text(200)).max(15).optional(),
  visualizations: z.array(text(200)).max(20).optional(),
  businessRules: z.array(text(400)).max(15).optional(),
  attachments: z
    .array(z.object({ id: z.string().uuid(), role: text(200).optional() }))
    .max(10)
    .optional(),
  assumptions: z
    .array(z.object({ text: text(400).min(1), confirmed: z.boolean().default(false) }))
    .max(15)
    .optional(),
  questions: z.array(questionSchema).max(12).optional(),
  plan: z.array(planItemSchema).max(20).optional(),
  feasibility: text(400).optional(),
  ruleSet: z.string().max(60).optional(),
});
export type Requirements = z.infer<typeof requirementsSchema>;

export type SessionStatus =
  "gathering" | "awaiting_answers" | "building" | "complete" | "abandoned";

export type SessionRow = {
  id: string;
  user_id: string;
  report_id: string | null;
  title: string;
  status: SessionStatus;
  requirements: Requirements;
  created_at: string;
  updated_at: string;
};

function threadFilter(userId: string, reportId: string | null) {
  return [
    eq("user_id", userId),
    reportId ? eq("report_id", reportId) : { col: "report_id", op: "is_null" as const },
  ];
}

export async function getSession(
  userId: string,
  reportId: string | null,
): Promise<SessionRow | null> {
  const [row] = await agentDb().select<SessionRow>("bi_report_sessions", {
    filters: threadFilter(userId, reportId),
    limit: 1,
  });
  return row ?? null;
}

export async function getOrCreateSession(
  userId: string,
  reportId: string | null,
): Promise<SessionRow> {
  const existing = await getSession(userId, reportId);
  if (existing) return existing;
  const [row] = await agentDb().insert<SessionRow>("bi_report_sessions", {
    user_id: userId,
    report_id: reportId,
    title: "New report",
    status: "gathering",
    requirements: {},
  });
  return row!;
}

/**
 * Merge an update into a session. Lists replace the previous list when provided; questions
 * merge by id so answering one question doesn't drop the others.
 */
export function mergeRequirements(current: Requirements, patch: Requirements): Requirements {
  const next: Requirements = { ...current };
  for (const [k, v] of Object.entries(patch) as Array<[keyof Requirements, unknown]>) {
    if (v === undefined || k === "questions") continue;
    (next as Record<string, unknown>)[k] = v;
  }
  if (patch.questions) {
    const byId = new Map((current.questions ?? []).map((q) => [q.id, q]));
    for (const q of patch.questions) byId.set(q.id, { ...byId.get(q.id), ...q });
    next.questions = [...byId.values()];
  }
  return next;
}

export async function updateSession(
  session: SessionRow,
  patch: { requirements?: Requirements; status?: SessionStatus; title?: string },
): Promise<SessionRow> {
  const requirements = patch.requirements
    ? mergeRequirements(session.requirements ?? {}, requirementsSchema.parse(patch.requirements))
    : session.requirements;
  const open = (requirements.questions ?? []).some((q) => q.status === "open");
  const status =
    patch.status ??
    (open
      ? "awaiting_answers"
      : session.status === "awaiting_answers"
        ? "gathering"
        : session.status);
  const [row] = await agentDb().update<SessionRow>("bi_report_sessions", [eq("id", session.id)], {
    requirements,
    status,
    ...(patch.title ? { title: patch.title.slice(0, 160) } : {}),
  });
  return row!;
}

/** A draft conversation that produced a report now belongs to that report. */
export async function attachSessionToReport(userId: string, reportId: string): Promise<void> {
  const draft = await getSession(userId, null);
  if (!draft) return;
  const existing = await getSession(userId, reportId);
  if (existing) {
    await updateSession(existing, { requirements: draft.requirements });
    await agentDb().remove("bi_report_sessions", [eq("id", draft.id)]);
    return;
  }
  await agentDb().update("bi_report_sessions", [eq("id", draft.id)], { report_id: reportId });
}

export async function clearSession(userId: string, reportId: string | null): Promise<void> {
  await agentDb().remove("bi_report_sessions", threadFilter(userId, reportId));
}

/** Compact text for Dexter's assignment message (data, not instructions). */
export function describeSession(s: SessionRow | null): string | null {
  if (!s) return null;
  const r = s.requirements ?? {};
  const lines: string[] = [`Status: ${s.status}`];
  const list = (label: string, v?: string[]) =>
    v?.length && lines.push(`${label}: ${v.join("; ")}`);
  if (r.goal) lines.push(`Goal: ${r.goal}`);
  if (r.audience) lines.push(`Audience: ${r.audience}`);
  list("Data sources", r.dataSources);
  list("Metrics", r.metrics);
  list("Calculations", r.calculations);
  list("Filters", r.filters);
  list("Visualizations", r.visualizations);
  list("Business rules", r.businessRules);
  if (r.ruleSet) lines.push(`Rule set: ${r.ruleSet}`);
  if (r.assumptions?.length)
    lines.push(
      `Assumptions: ${r.assumptions.map((a) => `${a.text}${a.confirmed ? " (confirmed)" : " (unconfirmed)"}`).join("; ")}`,
    );
  for (const q of r.questions ?? [])
    lines.push(`Question [${q.id}] ${q.status}: ${q.question}${q.answer ? ` → ${q.answer}` : ""}`);
  if (r.plan?.length)
    lines.push(`Plan: ${r.plan.map((p) => `${p.title} (${p.status})`).join("; ")}`);
  if (r.feasibility) lines.push(`Feasibility: ${r.feasibility}`);
  if (r.attachments?.length)
    lines.push(
      `Referenced attachments: ${r.attachments.map((a) => `${a.id}${a.role ? ` (${a.role})` : ""}`).join(", ")}`,
    );
  return lines.join("\n");
}
