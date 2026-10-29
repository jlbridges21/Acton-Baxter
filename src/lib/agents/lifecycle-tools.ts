/**
 * Sam's HR lifecycle tools (staff lifecycle checklist). Read-only: Sam explains the checklist,
 * previews what a case would contain, and reports case status. Starting a case, changing a task,
 * or recording access happens in Sam Operations by authorized people; Sam coordinates and never
 * decides.
 *
 * Data minimization: no tool returns names, contact details, evidence notes, or document
 * contents. Cases are identified by their reference (e.g. LC-3F2A9B). Log summaries never name
 * anyone.
 */

import "server-only";

import { z } from "zod";
import type { AgentTool } from "./tools";

const STUDIO = "/ai/operations?tab=lifecycle";
const PHASES = ["preboarding", "onboarding", "offboarding"] as const;
const ROLES = ["design", "sales", "marketing", "field"] as const;

async function opsAccess(ctx: Parameters<AgentTool["execute"]>[0]) {
  const { getOpsAccess } = await import("@/lib/ops/org");
  return getOpsAccess(ctx.requester);
}

const lifecycleChecklist: AgentTool = {
  key: "lifecycle_checklist",
  label: "Look up the staff lifecycle checklist",
  description:
    "Find items in the leadership Staff Lifecycle Checklist (pre-boarding, onboarding, offboarding, recurring compliance) with their exact wording, section, tags, citations, owner, timing, and whether the legal timing has been verified.",
  modelUsage:
    'lifecycle_checklist {"phase"?: "preboarding"|"onboarding"|"offboarding"|"recurring", "query"?: string, "role"?: "design"|"sales"|"marketing"|"field"} — returns matching checklist items with their source reference. Quote the wording and cite "Staff Lifecycle Checklist, <part>, <section>, item <n>, version <v>". Say "unverified" for legal timing that has not been verified.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    phase: z.enum([...PHASES, "recurring"]).optional(),
    query: z.string().trim().max(120).optional(),
    role: z.enum(ROLES).optional(),
  }),
  async execute(_ctx, raw) {
    const args = this.args.parse(raw) as {
      phase?: (typeof PHASES)[number] | "recurring";
      query?: string;
      role?: (typeof ROLES)[number];
    };
    const svc = await import("@/lib/hr-lifecycle/service");
    const catalog = await svc.currentCatalog();
    const { agentDb } = await import("./store");
    const verRows = await agentDb().select<{ item_id: string; status: string }>(
      "ops_compliance_verifications",
      {},
    );
    const verification = (id: string) => {
      const rows = verRows.filter((r) => r.item_id === id);
      if (!rows.length) return null;
      if (rows.some((r) => r.status === "discrepancy")) return "discrepancy";
      return rows.every((r) => r.status === "verified") ? "verified" : "unverified";
    };
    const q = (args.query ?? "").toLowerCase().trim();
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    const match = (text: string) => {
      const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      return (
        !q ||
        t.includes(` ${q.replace(/[^a-z0-9]+/g, " ").trim()} `) ||
        words.every((w) => t.includes(` ${w}`))
      );
    };
    if (args.phase === "recurring") {
      const items = catalog.recurring
        .filter((r) => match(`${r.item} ${r.when} ${r.requirement}`))
        .map((r) => ({
          item: r.item,
          when: r.when,
          requirement: r.requirement,
          verification: r.tags.length ? (verification(r.id) ?? "unverified") : "not a legal item",
          flags: r.flags,
        }));
      return {
        data: {
          document: `${catalog.title}, version ${catalog.documentVersion}`,
          part: "Recurring compliance calendar",
          items,
          manage: `${STUDIO}&view=compliance`,
        },
        logSummary: `Read ${items.length} recurring compliance item(s).`,
        sources: [
          {
            documentId: null,
            title: `${catalog.title} (${catalog.documentVersion})`,
            excerpt: "Recurring compliance calendar",
          },
        ],
      };
    }
    const items = catalog.items
      .filter((i) => !args.phase || i.phase === args.phase)
      .filter((i) => !args.role || i.roles === "general" || i.roles.includes(args.role))
      .filter((i) => match(`${i.text} ${i.title} ${i.sourceRef.section}`))
      .slice(0, 40)
      .map((i) => ({
        id: i.id,
        wording: i.text,
        part: i.sourceRef.part,
        section: i.sourceRef.section,
        itemNumber: i.sourceRef.ordinal,
        legal: i.tags.length ? i.tags.map((t) => `[${t}]`).join(" ") : "best practice (untagged)",
        citations: i.citations.map((c) => `${c.reference} (${c.authority})`),
        verification: i.tags.length ? (verification(i.id) ?? "unverified") : null,
        appliesTo: i.roles === "general" ? "all staff" : i.roles.join(", "),
        conditions: i.conditions,
        owner: i.owner,
        timing: i.timingText || null,
        flags: i.flags,
      }));
    return {
      data: {
        document: `${catalog.title}, version ${catalog.documentVersion}`,
        items,
        note: "Legal deadlines stay unverified until a named reviewer checks the official DIR, EDD, CRD, or federal source. This is not legal advice.",
      },
      logSummary: `Read ${items.length} checklist item(s).`,
      sources: [
        { documentId: null, title: `${catalog.title} (${catalog.documentVersion})`, excerpt: "" },
      ],
    };
  },
};

const lifecyclePlanPreview: AgentTool = {
  key: "lifecycle_plan_preview",
  label: "Preview a lifecycle plan",
  description:
    "Show which checklist tasks a hypothetical hire or departure would get (by role, exempt status, dates, separation type), with due dates, owners, reasons for inclusion or exclusion, legal flags, licensed seats, missing information, and missing approvals. Uses no employee record.",
  modelUsage:
    'lifecycle_plan_preview {"phase": "preboarding"|"onboarding"|"offboarding", "roles"?: ("design"|"sales"|"marketing"|"field")[], "exempt"?: boolean, "supervisor"?: boolean, "separation"?: "resignation_with_notice"|"resignation_without_notice"|"involuntary"|"layoff", "offerDate"?: "YYYY-MM-DD", "startDate"?: "YYYY-MM-DD", "noticeDate"?: "YYYY-MM-DD", "lastDay"?: "YYYY-MM-DD"} — a hypothetical preview; never a decision. To start a real case, send the person to the Start wizard.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({
    phase: z.enum(PHASES),
    roles: z.array(z.enum(ROLES)).max(4).default([]),
    exempt: z.boolean().optional(),
    supervisor: z.boolean().optional(),
    separation: z
      .enum(["resignation_with_notice", "resignation_without_notice", "involuntary", "layoff"])
      .optional(),
    offerDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    noticeDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    lastDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  async execute(_ctx, raw) {
    const a = this.args.parse(raw) as {
      phase: (typeof PHASES)[number];
      roles: (typeof ROLES)[number][];
      exempt?: boolean;
      supervisor?: boolean;
      separation?:
        "resignation_with_notice" | "resignation_without_notice" | "involuntary" | "layoff";
      offerDate?: string;
      startDate?: string;
      noticeDate?: string;
      lastDay?: string;
    };
    const { buildLifecyclePlan } = await import("@/lib/hr-lifecycle/plan");
    const svc = await import("@/lib/hr-lifecycle/service");
    const { itemsFromDefinition } = await import("@/lib/hr-lifecycle/templates");
    const { decisionValue } = await import("@/lib/ops/org");
    let items;
    let templateNote = "";
    try {
      const t = await svc.lifecycleTemplate(a.phase);
      items = itemsFromDefinition((t.published ?? t.latest)!.definition);
      if (!t.published)
        templateNote = "The template is still a draft; leadership has not published it.";
    } catch {
      const { CHECKLIST_CATALOG, itemsForPhase, OFFBOARDING_AUTHORIZATION } =
        await import("@/lib/hr-lifecycle/catalog");
      items = [
        ...(a.phase === "offboarding" ? [OFFBOARDING_AUTHORIZATION] : []),
        ...itemsForPhase(a.phase, CHECKLIST_CATALOG),
      ];
      templateNote =
        "Lifecycle templates are not set up yet; this preview uses the checklist as imported.";
    }
    const hc = await decisionValue("company_headcount");
    const plan = buildLifecyclePlan({
      phase: a.phase,
      items,
      profile: {
        roles: a.roles,
        rolesConfirmed: true,
        exempt: a.exempt ?? null,
        supervisor: a.supervisor ?? null,
        headcount: typeof hc === "number" ? hc : null,
        onGroupHealth: null,
        separation: a.separation ?? null,
      },
      dates: {
        offer_date: a.offerDate,
        start_date: a.startDate,
        notice_date: a.noticeDate,
        last_day: a.lastDay,
      },
    });
    return {
      data: {
        hypothetical: true,
        templateNote: templateNote || null,
        counts: plan.counts,
        included: plan.items
          .filter((i) => i.included)
          .map((i) => ({
            task: i.title,
            section: i.section,
            owner: i.owner,
            due: i.due,
            legal: i.legal ? i.citations.map((c) => c.reference).join("; ") || "legal" : null,
          })),
        notApplicable: plan.items
          .filter((i) => !i.included)
          .map((i) => ({ task: i.title, why: i.reasons.filter(Boolean).join(" ") })),
        legalFlags: plan.legalFlags,
        licensedSeats: plan.licenseNeeds.map((l) => l.message),
        missingInformation: plan.missingInfo,
        missingApprovals: plan.missingApprovals,
        notes: plan.notes,
        startWizard: `${STUDIO}&view=start`,
      },
      logSummary: `Previewed a hypothetical ${a.phase} plan (${plan.counts.included} tasks).`,
    };
  },
};

const lifecycleCases: AgentTool = {
  key: "lifecycle_cases",
  label: "Read lifecycle case status",
  description:
    "Status of pre-boarding, onboarding, and offboarding cases the requester may see: progress, overdue and blocked tasks, approvals waiting, and next steps. Cases are identified by reference, not by name.",
  modelUsage:
    'lifecycle_cases {"reference"?: string (e.g. "LC-3F2A9B")} — without a reference, lists visible cases; with one, lists that case\'s tasks in date order (owner role, due date, status). Never infer or reveal who a case is about.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ reference: z.string().trim().max(20).optional() }),
  async execute(ctx, raw) {
    const { reference } = this.args.parse(raw) as { reference?: string };
    const access = await opsAccess(ctx);
    const svc = await import("@/lib/hr-lifecycle/service");
    const cases = await svc.listCases(access);
    if (!reference) {
      return {
        data: {
          scope: access.canViewAll
            ? "All lifecycle cases."
            : "Only cases with tasks assigned to the requester.",
          cases: cases.slice(0, 30).map((c) => ({
            reference: c.reference,
            phase: c.phase,
            status: c.status,
            test: c.mode === "test",
            progress: `${c.progress}%`,
            statusCounts: c.counts,
            nextTask: c.nextTask,
            nextDue: c.nextDue,
            missingInformation: c.missingInfo.length,
          })),
          dashboard: STUDIO,
        },
        logSummary: `Read ${Math.min(cases.length, 30)} lifecycle case(s).`,
      };
    }
    const match = cases.find((c) => c.reference.toLowerCase() === reference.toLowerCase());
    if (!match)
      return {
        data: { found: false, note: "No case with that reference is visible to this person." },
        logSummary: "No matching lifecycle case.",
      };
    const detail = await svc.caseDetail(match.id, access);
    return {
      data: {
        reference: match.reference,
        phase: match.phase,
        status: match.status,
        documentVersion: match.documentVersion,
        tasks: detail.tasks.map((t) => ({
          task: t.title,
          owner: t.owner,
          due: t.due,
          status: t.display,
          blockedBy: t.blockedBy,
          legal: t.tags.length ? (t.verification ?? "unverified") : null,
          approvalsWaiting: t.approvals.filter((a) => a.status === "pending_approval").length,
        })),
        link: `${STUDIO}&case=${match.id}`,
      },
      logSummary: `Read lifecycle case ${match.reference}.`,
    };
  },
};

export const LIFECYCLE_TOOLS: AgentTool[] = [
  lifecycleChecklist,
  lifecyclePlanPreview,
  lifecycleCases,
];
export const LIFECYCLE_TOOL_KEYS = LIFECYCLE_TOOLS.map((t) => t.key);
