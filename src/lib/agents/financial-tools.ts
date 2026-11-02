/**
 * Dexter's tools for JobTread financial reporting: readiness, invoices (with reconciled
 * totals), a project's PP# milestone → invoice → payment drill, week-over-week changes from
 * snapshots, alerts, and Project Manager completeness. All read-only; financial figures need
 * the requester's financial access, exactly as in Reports. When something isn't configured,
 * results name the Data settings page an administrator uses to fix it.
 */

import "server-only";

import { z } from "zod";
import { requireReportsAccess, type ReportsAccess } from "@/lib/reports/access";
import type { AgentTool, ToolResult } from "./tools";

async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "That didn't work.";
    return {
      data: { ok: false, problem: message },
      logSummary: `Refused: ${message.slice(0, 80)}`,
    };
  }
}

function needFinancial(access: ReportsAccess) {
  if (!access.categories.has("financial"))
    throw new Error(
      "Invoice, payment, and balance figures need financial access in Reports. An administrator can grant it on Dexter's Access tab.",
    );
}

const SETTINGS = "Reports → Data settings → Financial data";

const readinessArgs = z.object({});
const readinessTool: AgentTool = {
  key: "reports_financial_readiness",
  label: "Check financial reporting readiness",
  description:
    "Whether invoices, payments, tasks, Project Manager, PP# mapping, snapshots, and alerts are ready, and what an administrator must configure.",
  modelUsage: `reports_financial_readiness {} — call before answering invoice, payment, overdue, PP#, milestone, or week-over-week questions. Each area has a state (ready, partially_configured, incomplete_source_data, requires_mapping, sync_disabled, unsupported, requires_migration) and the setting that fixes it. If an area isn't ready, say so plainly and point an administrator to that setting (${SETTINGS}); never present incomplete totals as complete or missing payments as $0.`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: readinessArgs,
  async execute(ctx) {
    return guarded(async () => {
      const access = await requireReportsAccess(ctx.requester);
      const { financialReadiness } = await import("@/lib/reports/financial-overview");
      const r = await financialReadiness();
      const financial = access.categories.has("financial");
      return {
        data: {
          areas: r.areas.map((a) => ({
            area: a.label,
            state: a.state,
            detail: a.detail,
            fixIn: a.setting,
          })),
          counts: r.counts,
          ...(financial ? { totals: r.totals } : { totals: "hidden (needs financial access)" }),
          historicalDiagnostics: r.diagnostics,
        },
        logSummary: `Financial readiness: ${r.areas.filter((a) => a.state === "ready").length}/${r.areas.length} ready`,
      };
    });
  },
};

const invoiceArgs = z.object({
  action: z.enum(["summary", "list", "overdue", "by_pm"]).default("summary"),
  projectManager: z.string().max(80).optional(),
  jobId: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(100).default(40),
});
const invoicesTool: AgentTool = {
  key: "reports_invoices",
  label: "Invoices and balances",
  description:
    "Customer invoices with lifecycle status, payment status, verified balances, and reconciled totals.",
  modelUsage:
    'reports_invoices {"action": "summary"|"list"|"overdue"|"by_pm", "projectManager"?, "jobId"?, "limit"?} — totals (invoiced, paid, outstanding, overdue) never double count: they come from JobTread document amounts; payments only verify them. A null total or completeness "partial"/"incomplete" means data is missing — report it as incomplete with the reasons, never as zero. "overdue" lists only invoices with a verified unpaid balance; if balances are unverified say so. For saved reports, use the "documents" source (doc.* fields) with reports_create.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: invoiceArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = invoiceArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      needFinancial(access);
      const { financialState } = await import("@/lib/reports/financial-overview");
      const state = await financialState({
        ...(a.jobId ? { jobIds: new Set([a.jobId]) } : {}),
        ...(a.projectManager ? { pm: a.projectManager } : {}),
      });
      const jobs = state.ctx.jobs;
      const brief = (i: (typeof state.invoices)[number]) => ({
        id: i.doc.id,
        number: i.doc.number,
        name: i.doc.name,
        job: i.doc.job_id ? (jobs.get(i.doc.job_id)?.name ?? i.doc.job_id) : null,
        lifecycle: i.facts.lifecycle,
        paymentStatus: i.facts.paymentStatus,
        balanceVerification: i.facts.verification,
        total: i.facts.total,
        amountPaid: i.facts.amountPaid,
        balance: i.facts.balance,
        dueDate: i.doc.due_date,
        daysPastDue: i.facts.daysPastDue,
        overdue: i.facts.overdue,
      });
      if (a.action === "by_pm") {
        const groups = new Map<
          string,
          { outstanding: number | null; invoices: number; unverified: number }
        >();
        for (const r of state.outstandingByPm) {
          const pm = r.pm ?? "(No project manager in JobTread)";
          const g = groups.get(pm) ?? { outstanding: 0, invoices: 0, unverified: 0 };
          g.invoices++;
          g.outstanding =
            g.outstanding === null || r.balance === null
              ? null
              : Math.round((g.outstanding + r.balance) * 100) / 100;
          if (!r.verified) g.unverified++;
          groups.set(pm, g);
        }
        return {
          data: {
            byProjectManager: Object.fromEntries(groups),
            totals: state.totals,
            note: "Project Manager comes from the job's JobTread field; jobs without one are grouped separately (never assigned).",
          },
          logSummary: `Outstanding by PM: ${groups.size} groups`,
        };
      }
      const list =
        a.action === "overdue"
          ? state.invoices.filter((i) => i.facts.overdue === true)
          : a.action === "list"
            ? state.invoices
            : [];
      const unknownOverdue = state.invoices.filter(
        (i) => i.facts.overdue === null && (i.facts.balance ?? 0) > 0,
      ).length;
      return {
        data: {
          totals: state.totals,
          ...(list.length || a.action !== "summary"
            ? { invoices: list.slice(0, a.limit).map(brief), totalMatching: list.length }
            : {}),
          ...(a.action === "overdue" && unknownOverdue
            ? {
                unverifiedOpenInvoices: unknownOverdue,
                note: `These ${unknownOverdue} invoices have a balance that isn't verified, so they can't be called overdue or current. ${SETTINGS} → Status mapping & balances.`,
              }
            : {}),
        },
        logSummary: `Invoices ${a.action}: ${state.totals.invoiceCount} invoices, ${state.totals.completeness}`,
      };
    });
  },
};

const projectArgs = z.object({
  jobId: z.string().max(80).optional(),
  jobName: z.string().max(120).optional(),
});
const projectTool: AgentTool = {
  key: "reports_project_financials",
  label: "Project PP# milestones, invoices, and payments",
  description:
    "One project's drill: PP# milestone → invoice → payments, using only verified relationships.",
  modelUsage:
    'reports_project_financials {"jobId"? | "jobName"?} — returns `levels` (project, milestone, invoice, payments) with enabled flags and reasons. Only describe levels that are enabled; for disabled ones repeat the reason (e.g. PP# mapping not configured, payment sync off). If several jobs match the name, list them and ask which.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: projectArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = projectArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      needFinancial(access);
      const { loadFinancialContext } = await import("@/lib/reports/financial-data");
      const fctx = await loadFinancialContext();
      let jobId = a.jobId;
      if (!jobId && a.jobName) {
        const q = a.jobName.trim().toLowerCase();
        const hits = [...fctx.jobs.values()].filter(
          (j) => j.name.toLowerCase().includes(q) || j.number === a.jobName,
        );
        if (hits.length !== 1)
          return {
            data: hits.length
              ? {
                  status: "ambiguous",
                  matches: hits
                    .slice(0, 10)
                    .map((j) => ({ id: j.id, name: j.name, number: j.number })),
                }
              : { status: "not_found", message: `No synced job matches "${a.jobName}".` },
            logSummary: `Project lookup "${a.jobName}": ${hits.length} matches`,
          };
        jobId = hits[0]!.id;
      }
      if (!jobId) throw new Error("Pass jobId or jobName.");
      const { projectFinancialDrill } = await import("@/lib/reports/pp-mapping");
      const drill = await projectFinancialDrill(jobId);
      return { data: drill, logSummary: `Project drill ${drill.job.name}` };
    });
  },
};

const weekArgs = z.object({
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const weekTool: AgentTool = {
  key: "reports_week_compare",
  label: "What changed since last week",
  description:
    "Week-over-week changes from the immutable weekly snapshots (invoiced, paid, outstanding, overdue, PM balances, forecasts).",
  modelUsage: `reports_week_compare {"periodStart"?: "YYYY-MM-DD"} — answers "what changed since last Monday". If it returns ok:false, explain the reason (no snapshots yet, or only one week) and that history starts when snapshots are turned on (${SETTINGS} → Snapshots); never reconstruct past weeks. Mention caveats on changes (incomplete data or a calculation-version change).`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: weekArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = weekArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const { compareLatestWeeks } = await import("@/lib/reports/snapshots");
      const r = await compareLatestWeeks({ periodStart: a.periodStart });
      if (r.ok && !access.categories.has("financial")) {
        return {
          data: {
            ...r,
            changes: r.changes.filter(
              (c) => c.unit !== "currency" && !c.metric.startsWith("overdue"),
            ),
            note: "Financial changes hidden (needs financial access).",
          },
          logSummary: "Week compare (non-financial)",
        };
      }
      return {
        data: r,
        logSummary: r.ok
          ? `Week compare ${r.previous} → ${r.current}: ${r.changes.length} changes`
          : "Week compare unavailable",
      };
    });
  },
};

const alertArgs = z.object({ status: z.enum(["open", "acknowledged", "resolved"]).optional() });
const alertsTool: AgentTool = {
  key: "reports_alerts",
  label: "Financial and schedule alerts",
  description:
    "Alerts addressed to the requester (overdue invoices, forecast slips and improvements, high risk, full recovery).",
  modelUsage: `reports_alerts {"status"?} — lists alerts the requester may see. Alerts exist only for rules an administrator configured (${SETTINGS} → Alerts); if there are none, say no rules are configured rather than "nothing is wrong".`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: alertArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = alertArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const { alertInbox, listAlertRules } = await import("@/lib/reports/alerts");
      const [inbox, rules] = await Promise.all([
        alertInbox(ctx.requester, access, { status: a.status, limit: 50 }),
        listAlertRules(),
      ]);
      return {
        data: {
          migrated: inbox.migrated,
          rulesConfigured: rules.rules.length,
          rulesEnabled: rules.rules.filter((r) => r.enabled).length,
          alerts: inbox.events.map((e) => ({
            title: e.title,
            kind: e.kind,
            severity: e.severity,
            status: e.status,
            since: e.first_seen_at,
            rule: e.ruleName,
          })),
        },
        logSummary: `Alerts: ${inbox.events.length}`,
      };
    });
  },
};

const pmTool: AgentTool = {
  key: "reports_pm_completeness",
  label: "Project Manager completeness",
  description:
    "How many jobs have a Project Manager in JobTread, and why the rest don't (mapping, exclusion, sync, or blank in JobTread).",
  modelUsage:
    "reports_pm_completeness {} — use when Project Manager counts look low or someone asks why a job has no PM. Never guess a PM; blank in JobTread means blank.",
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({}),
  async execute(ctx) {
    return guarded(async () => {
      await requireReportsAccess(ctx.requester);
      const { projectManagerAudit } = await import("@/lib/reports/financial-overview");
      const pm = await projectManagerAudit();
      return {
        data: { ...pm, blankOpenJobs: pm.blankOpenJobs.slice(0, 25) },
        logSummary: `PM completeness ${pm.populated}/${pm.totalJobs}`,
      };
    });
  },
};

const ppArgs = z.object({
  action: z
    .enum(["by_project", "by_number", "missing_milestone", "pending", "schedule"])
    .default("by_project"),
  pp: z.number().int().min(1).max(10).optional(),
  jobId: z.string().max(80).optional(),
  jobName: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(60),
});
const ppTool: AgentTool = {
  key: "reports_pp_milestones",
  label: "PP# progress-payment milestones",
  description:
    "PP#1–PP#10 invoices by project or number, their linked milestone tasks, invoices missing a milestone, pending approvals, and each project's PP# schedule.",
  modelUsage: `reports_pp_milestones {"action": "by_project"|"by_number"|"missing_milestone"|"pending"|"schedule", "pp"?: 1-10, "jobId"? | "jobName"?, "limit"?} — every invoice has ppApproval: only "Approved" (verified: true) links are verified milestones; "Pending approval", "Classified by rule (no link yet)", and auto-accepted links must be described as unreviewed. Never call an unapproved link verified. Payment fields: "Unverified" or null means payment data isn't available — say so, never $0. "schedule" needs a project and shows PP#1–10 with the configured % (standard or labelled project override) — percentages are a split, not amounts paid. If ppConfigured is false, tell an administrator to configure ${SETTINGS} → PP# mapping.`,
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: ppArgs,
  async execute(ctx, raw) {
    return guarded(async () => {
      const a = ppArgs.parse(raw ?? {});
      const access = await requireReportsAccess(ctx.requester);
      const financial = access.categories.has("financial");
      const { documentRows, loadFinancialContext } = await import("@/lib/reports/financial-data");
      const fctx = await loadFinancialContext();
      let jobId = a.jobId;
      if (!jobId && a.jobName) {
        const q = a.jobName.trim().toLowerCase();
        const hits = [...fctx.jobs.values()].filter(
          (j) => j.name.toLowerCase().includes(q) || j.number === a.jobName,
        );
        if (hits.length !== 1)
          return {
            data: hits.length
              ? {
                  status: "ambiguous",
                  matches: hits
                    .slice(0, 10)
                    .map((j) => ({ id: j.id, name: j.name, number: j.number })),
                }
              : { status: "not_found", message: `No synced project matches "${a.jobName}".` },
            logSummary: `PP# project lookup: ${hits.length} matches`,
          };
        jobId = hits[0]!.id;
      }
      const ppConfigured = fctx.pp.config.classification.mode !== "none";
      const rows = documentRows(fctx).filter(
        (r) => r["doc.type"] === "Customer invoice" && (!jobId || r["doc.jobId"] === jobId),
      );
      const brief = (r: (typeof rows)[number]) => ({
        invoiceId: r.id,
        number: r["doc.number"],
        name: r["doc.name"],
        project: r["doc.job"],
        customer: r["doc.customer"],
        pp: r["doc.ppNumber"],
        percent: r["doc.milestonePct"],
        percentSource: r["doc.milestonePctSource"],
        ppApproval: r["doc.ppApproval"],
        verified: r["doc.ppVerified"] === true,
        milestone: r["doc.milestone"],
        milestoneScheduledStart: r["doc.milestoneStart"],
        milestoneScheduledEnd: r["doc.milestoneEnd"],
        milestoneComplete: r["doc.milestoneComplete"],
        invoiceStatus: r["doc.lifecycle"],
        ...(financial
          ? {
              amount: r["doc.total"],
              paymentStatus: r["doc.paymentStatus"],
              balanceVerification: r["doc.balanceVerification"],
            }
          : { amount: "hidden (needs financial access)" }),
      });
      const pp = rows.filter((r) => r["doc.ppNumber"] !== null);
      let data: Record<string, unknown>;
      if (a.action === "schedule") {
        if (!jobId) throw new Error("Pass jobId or jobName for a project's PP# schedule.");
        const { projectFinancialDrill } = await import("@/lib/reports/pp-mapping");
        data = { ...(await projectFinancialDrill(jobId)) };
        if (!financial)
          data = {
            ...data,
            note: "Amounts and payments hidden (needs financial access).",
            pp:
              (data.pp as Array<Record<string, unknown>> | null)?.map((p) => ({
                ...p,
                invoices: (p.invoices as Array<Record<string, unknown>>).map((i) => ({
                  ...i,
                  total: undefined,
                  payments: undefined,
                })),
              })) ?? null,
          };
      } else if (a.action === "by_number") {
        if (!a.pp) throw new Error("Pass pp (1–10).");
        data = {
          invoices: pp
            .filter((r) => r["doc.ppNumber"] === a.pp)
            .slice(0, a.limit)
            .map(brief),
        };
      } else if (a.action === "missing_milestone") {
        data = {
          invoices: pp
            .filter((r) => !r["doc.milestoneTaskId"])
            .slice(0, a.limit)
            .map(brief),
          note: "PP# invoices without an approved milestone task.",
        };
      } else if (a.action === "pending") {
        data = {
          invoices: rows
            .filter((r) =>
              [
                "Pending approval",
                "Auto-accepted (unique match)",
                "Ambiguous — needs manual review",
                "Unclassified",
                "Approved — needs review (conflict)",
              ].includes(String(r["doc.ppApproval"])),
            )
            .slice(0, a.limit)
            .map(brief),
        };
      } else {
        const byProject = new Map<string, ReturnType<typeof brief>[]>();
        for (const r of pp) {
          const k = String(r["doc.job"] ?? r["doc.jobId"] ?? "(no project)");
          byProject.set(k, [...(byProject.get(k) ?? []), brief(r)]);
        }
        data = { projects: Object.fromEntries([...byProject].slice(0, a.limit)) };
      }
      return {
        data: { ppConfigured, configVersion: fctx.pp.version, ...data },
        logSummary: `PP# ${a.action}: ${pp.length} PP# invoices`,
      };
    });
  },
};

export const FINANCIAL_TOOLS: AgentTool[] = [
  ppTool,
  readinessTool,
  invoicesTool,
  projectTool,
  weekTool,
  alertsTool,
  pmTool,
];
