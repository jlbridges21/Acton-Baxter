/**
 * Organization setup for Sam Operations: legal entities, the leadership decision log, and
 * role resolution (CEO, COO, HR administrators, head of finance).
 *
 * Roles come only from decisions confirmed in the Setup screen — never from names, Slack
 * display names, or anything a model says. Until the CEO and COO accounts are confirmed,
 * nothing can be approved and therefore nothing consequential can run.
 */

import "server-only";

import { AuthorizationError, ValidationError } from "@/lib/errors";
import { isAdminRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, isUniqueViolation, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";

export type DecisionInput =
  "person" | "people" | "text" | "longtext" | "date" | "choice" | "number" | "none";

type DecisionDef = {
  key: string;
  section: string;
  title: string;
  description: string;
  input: DecisionInput;
  options?: string[];
};

const d = (
  section: string,
  key: string,
  title: string,
  description: string,
  input: DecisionInput = "none",
  options?: string[],
): DecisionDef => ({ key, section, title, description, input, options });

/** Part 25 of the implementation brief + "Decisions to confirm" from the leadership brief. */
export const DECISION_DEFS: DecisionDef[] = [
  d(
    "Organization",
    "legal_entities",
    "Confirm legal entities",
    "The brief names Acton Construction and its subsidiary Acton ADU. Confirm both (and their identifiers) on the Entities card.",
  ),
  d(
    "Organization",
    "ceo_account",
    "Confirm the CEO's Baxter account",
    "Only the confirmed CEO and COO accounts can approve Sam's actions.",
    "person",
  ),
  d(
    "Organization",
    "coo_account",
    "Confirm the COO's Baxter account",
    "The COO also owns all access provisioning and removal steps.",
    "person",
  ),
  d(
    "Organization",
    "hr_admins",
    "Authorized HR administrators",
    "People who may configure workflows and see HR records (they cannot approve).",
    "people",
  ),
  d(
    "Organization",
    "finance_owner",
    "Head of finance",
    "Finance-dependent steps and timecard escalations are routed here. Sam never executes them.",
    "person",
  ),
  d(
    "Organization",
    "workflow_owners",
    "Workflow owners",
    "Who owns each recurring workflow.",
    "longtext",
  ),
  d(
    "Organization",
    "launch_date",
    "Operational launch date",
    "Kickoff and launch dates tied to the 45-day plan.",
    "date",
  ),
  d(
    "Organization",
    "timezone",
    "Operating time zone",
    "Used for reminders, cutoffs, and scheduling (operations are in the South Bay and Los Angeles).",
    "choice",
    ["America/Los_Angeles"],
  ),
  d(
    "Documents",
    "onboarding_checklist",
    "Official onboarding checklist",
    "Leadership supplies the checklist; Sam's starter onboarding workflow is not official until this is confirmed.",
    "longtext",
  ),
  d(
    "Documents",
    "offboarding_checklist",
    "Official offboarding checklist",
    "Leadership supplies the checklist; the starter offboarding workflow is not official until this is confirmed.",
    "longtext",
  ),
  d(
    "Documents",
    "required_documents",
    "Required employee documents",
    "Which documents each new hire must provide, per entity.",
    "longtext",
  ),
  d(
    "Documents",
    "contract_templates",
    "Approved contract templates",
    "Current approved contract versions to load into the template library.",
    "longtext",
  ),
  d(
    "Documents",
    "drive_destinations",
    "Google Drive destinations",
    "Designated folders per entity for employee documents, contract templates, and archived contracts (set on the Integrations tab).",
    "longtext",
  ),
  d(
    "Documents",
    "naming_conventions",
    "File naming conventions",
    "How filed documents are named.",
    "text",
  ),
  d(
    "Documents",
    "retention_policy",
    "Retention policy",
    "How long employee documents and contracts are kept.",
    "longtext",
  ),
  d(
    "Access & approvals",
    "record_access",
    "Who may access employee records",
    "Confirm whether employees may obtain only their own records and general policies through Baxter.",
    "longtext",
  ),
  d(
    "Access & approvals",
    "manager_exceptions",
    "Manager access exceptions",
    "Whether managers may see their reports' HR records, and which.",
    "longtext",
  ),
  d(
    "Access & approvals",
    "approval_boundary",
    "Approval boundary",
    "Which internal checks and preparation may happen without approval; everything else stays approval-controlled.",
    "longtext",
  ),
  d(
    "Access & approvals",
    "standing_approvals",
    "Standing approval policy",
    "Whether recurring workflows may run under a standing approval or need per-action approval. Until confirmed, every action needs separate approval.",
    "choice",
    ["Per-action approval", "Standing approval per workflow"],
  ),
  d(
    "Access & approvals",
    "autonomy_rules",
    "Autonomy rules",
    "Any action types leadership allows Sam to execute without per-action approval (enabled on the Autonomy card).",
    "longtext",
  ),
  d(
    "Integrations",
    "bamboohr_access",
    "BambooHR API access",
    "Company subdomain, an API key for a dedicated integration user, and which fields Sam may update.",
    "longtext",
  ),
  d(
    "Integrations",
    "google_access",
    "Google Workspace access",
    "Gmail sending identity, calendar identities, and Drive folders (Gmail/Calendar need additional Google permissions).",
    "longtext",
  ),
  d(
    "Integrations",
    "betterteam_access",
    "BetterTeams publishing method",
    "No public BetterTeams API was found; confirm the publishing process or a supported integration.",
    "longtext",
  ),
  d(
    "Integrations",
    "docusign_access",
    "DocuSign account and API access",
    "Account plan (including whether DocuSign MSP is involved), integration key, and the signing user.",
    "longtext",
  ),
  d(
    "Integrations",
    "jobtread_timecards",
    "JobTread timecard availability",
    "JobTread currently has 0 time entries, so completeness can't be checked automatically until crews log time there.",
    "longtext",
  ),
  d(
    "Integrations",
    "slack_identity",
    "Slack identity mapping",
    "Confirm the CEO's and COO's Slack accounts are linked to their Baxter accounts.",
    "longtext",
  ),
  d(
    "Timecards",
    "timecard_cutoff",
    "Weekly timecard cutoff",
    "Day and time timecards are due.",
    "text",
  ),
  d(
    "Timecards",
    "timecard_reminders",
    "Reminder schedule",
    "When reminders go out before and after the cutoff.",
    "text",
  ),
  d(
    "Timecards",
    "timecard_escalation",
    "Escalation policy",
    "When unresolved timecards go to leadership before the payroll handoff.",
    "text",
  ),
  d(
    "Timecards",
    "timecard_reporting",
    "Timecard status reporting to finance",
    "What finance receives and when.",
    "longtext",
  ),
  d(
    "Surveys",
    "survey_anonymity",
    "Anonymity rules",
    "What anonymity is promised and the minimum group size for any breakdown.",
    "longtext",
  ),
  d(
    "Surveys",
    "survey_detail_access",
    "Meaning of 'specific survey detail'",
    "Whether leadership may see individual responses for non-anonymous surveys. Default: aggregated only.",
    "longtext",
  ),
  d(
    "Surveys",
    "survey_aggregation",
    "Aggregation requirements",
    "Which breakdowns leadership reports may show (e.g. by entity or department) and the minimum group size for each.",
    "longtext",
  ),
  d(
    "Surveys",
    "survey_owners",
    "Survey schedule and owners",
    "Survey cadence and question owners.",
    "longtext",
  ),
  d(
    "Legal & insurance",
    "subcontractor_boundary",
    "Subcontractor contract-review boundary",
    "Draft interpretation: review only — no subcontractor onboarding, records, timekeeping, or operations.",
    "choice",
    ["Review only (as drafted)", "Exclude subcontractor contracts"],
  ),
  d(
    "Legal & insurance",
    "contract_review_owner",
    "Contract review owner",
    "Who accepts Sam's contract recommendations.",
    "person",
  ),
  d(
    "Legal & insurance",
    "counsel_escalation",
    "Counsel escalation",
    "When and to whom contracts go for legal review.",
    "longtext",
  ),
  d(
    "Legal & insurance",
    "insurance_inventory",
    "Insurance policy inventory",
    "Policies, insurers, renewal dates, and reminder intervals (entered on the Insurance tab).",
    "longtext",
  ),
  d(
    "Legal & insurance",
    "insurance_owners",
    "Insurance renewal owners",
    "Who owns each policy renewal.",
    "longtext",
  ),
  d(
    "Operations",
    "volumes_budget",
    "Volumes, budget, hosting, and support",
    "Employee count, expected workflow volumes, recurring cost budget, and support arrangements.",
    "longtext",
  ),
];

export type DecisionRow = {
  key: string;
  section: string;
  title: string;
  description: string;
  status: "open" | "confirmed" | "not_applicable";
  value: unknown;
  confirmed_by: string | null;
  confirmed_at: string | null;
  note: string | null;
  updated_at: string;
};

export type EntityRow = {
  id: string;
  key: string;
  name: string;
  confirmed: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

let seeded: Promise<void> | null = null;
export function resetOpsOrgForTests() {
  seeded = null;
}

/** Create missing decision rows and the two entities named in the brief (unconfirmed). */
export function ensureOpsOrg(): Promise<void> {
  seeded ??= (async () => {
    const db = agentDb();
    const existing = new Set((await db.select<DecisionRow>("ops_decisions", {})).map((r) => r.key));
    for (const def of DECISION_DEFS) {
      if (existing.has(def.key)) continue;
      try {
        await db.insert("ops_decisions", {
          key: def.key,
          section: def.section,
          title: def.title,
          description: def.description,
          status: "open",
          value: null,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    for (const e of [
      { key: "acton_construction", name: "Acton Construction" },
      { key: "acton_adu", name: "Acton ADU" },
    ]) {
      if (await selectOne("ops_entities", { filters: [eq("key", e.key)] })) continue;
      try {
        await db.insert("ops_entities", { ...e, confirmed: false, active: true });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  })().catch((error) => {
    seeded = null;
    throw error;
  });
  return seeded;
}

export async function listDecisions(): Promise<
  Array<DecisionRow & { input: DecisionInput; options?: string[] }>
> {
  await ensureOpsOrg();
  const rows = new Map(
    (await agentDb().select<DecisionRow>("ops_decisions", {})).map((r) => [r.key, r]),
  );
  return DECISION_DEFS.map((def) => ({
    ...rows.get(def.key)!,
    title: def.title,
    description: def.description,
    section: def.section,
    input: def.input,
    options: def.options,
  }));
}

export async function listEntities(): Promise<EntityRow[]> {
  await ensureOpsOrg();
  return agentDb().select<EntityRow>("ops_entities", { order: { col: "name" } });
}

export async function decisionValue(key: string): Promise<unknown> {
  const row = await selectOne<DecisionRow>("ops_decisions", { filters: [eq("key", key)] });
  return row?.status === "confirmed" ? row.value : null;
}

export type OpsRoles = {
  ceo: string | null;
  coo: string | null;
  hrAdmins: string[];
  financeOwner: string | null;
  contractReviewOwner: string | null;
  timezone: string;
};

export async function getOpsRoles(): Promise<OpsRoles> {
  await ensureOpsOrg();
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const [ceo, coo, hr, finance, review, tz] = await Promise.all(
    [
      "ceo_account",
      "coo_account",
      "hr_admins",
      "finance_owner",
      "contract_review_owner",
      "timezone",
    ].map(decisionValue),
  );
  return {
    ceo: str(ceo),
    coo: str(coo),
    hrAdmins: list(hr),
    financeOwner: str(finance),
    contractReviewOwner: str(review),
    timezone: str(tz) ?? "America/Los_Angeles",
  };
}

export type OpsAccess = {
  userId: string | null;
  isAppAdmin: boolean;
  isCeo: boolean;
  isCoo: boolean;
  /** CEO or COO — the only people who can approve Sam's actions. */
  isLeadership: boolean;
  isHrAdmin: boolean;
  isFinanceOwner: boolean;
  leadershipConfirmed: boolean;
  /** Configure workflows, templates, registers. */
  canConfigure: boolean;
  /** See every employee's HR records, documents, and workflows. */
  canViewAll: boolean;
  /** Change leadership decisions, autonomy, and other sensitive settings. */
  canManageSensitive: boolean;
};

export async function getOpsAccess(requester: Requester): Promise<OpsAccess> {
  const roles = await getOpsRoles();
  const verified = requester.verifiedVia !== "unverified" && Boolean(requester.userId);
  const id = verified ? requester.userId : null;
  const isCeo = Boolean(id && roles.ceo === id);
  const isCoo = Boolean(id && roles.coo === id);
  const isLeadership = isCeo || isCoo;
  const isHrAdmin = Boolean(id && roles.hrAdmins.includes(id));
  const isAppAdmin = verified && isAdminRole(requester.role);
  const leadershipConfirmed = Boolean(roles.ceo || roles.coo);
  return {
    userId: id,
    isAppAdmin,
    isCeo,
    isCoo,
    isLeadership,
    isHrAdmin,
    isFinanceOwner: Boolean(id && roles.financeOwner === id),
    leadershipConfirmed,
    // App admins can set things up (they're implementing the system) but never approve.
    canConfigure: isLeadership || isHrAdmin || isAppAdmin,
    canViewAll: isLeadership || isHrAdmin,
    // Before leadership exists, an app admin bootstraps the decisions; afterwards only leadership.
    canManageSensitive: isLeadership || (isAppAdmin && !leadershipConfirmed),
  };
}

export function requireOps(
  access: OpsAccess,
  need: "configure" | "viewAll" | "sensitive" | "leadership",
) {
  const ok =
    need === "configure"
      ? access.canConfigure
      : need === "viewAll"
        ? access.canViewAll
        : need === "sensitive"
          ? access.canManageSensitive
          : access.isLeadership;
  if (!ok) {
    throw new AuthorizationError(
      need === "leadership"
        ? "Only the CEO or COO can do this."
        : need === "sensitive"
          ? "Only the CEO or COO can change this setting."
          : need === "viewAll"
            ? "You can only see your own HR records and tasks."
            : "Configuring Sam's workflows needs the CEO, COO, or an HR administrator.",
    );
  }
}

/** Record or change a decision. Leadership-account decisions are sensitive. */
export async function setDecision(input: {
  key: string;
  status: DecisionRow["status"];
  value?: unknown;
  note?: string | null;
  access: OpsAccess;
  actorLabel: string;
}): Promise<DecisionRow> {
  const def = DECISION_DEFS.find((x) => x.key === input.key);
  if (!def) throw new ValidationError("Unknown decision.");
  const sensitive = [
    "ceo_account",
    "coo_account",
    "hr_admins",
    "finance_owner",
    "standing_approvals",
    "autonomy_rules",
    "record_access",
    "manager_exceptions",
    "approval_boundary",
  ].includes(def.key);
  requireOps(input.access, sensitive ? "sensitive" : "configure");
  if (
    def.input === "person" &&
    input.status === "confirmed" &&
    (typeof input.value !== "string" || !/^[0-9a-f-]{36}$/i.test(input.value))
  ) {
    throw new ValidationError("Choose a person.");
  }
  if (
    def.input === "people" &&
    input.status === "confirmed" &&
    !(Array.isArray(input.value) && input.value.every((v) => typeof v === "string"))
  ) {
    throw new ValidationError("Choose people.");
  }
  await ensureOpsOrg();
  const previous = await selectOne<DecisionRow>("ops_decisions", {
    filters: [eq("key", input.key)],
  });
  const [row] = await agentDb().update<DecisionRow>("ops_decisions", [eq("key", input.key)], {
    status: input.status,
    value: input.value ?? null,
    note: input.note ?? null,
    confirmed_by: input.status === "confirmed" ? input.access.userId : null,
    confirmed_at: input.status === "confirmed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: "ops.decision_changed",
    targetType: "ops_decision",
    targetId: null,
    summary: `${def.title}: ${input.status}.`,
    details: { key: def.key, status: input.status, sensitive },
  });
  if (def.key === "ceo_account" || def.key === "coo_account") {
    await syncLeadershipSamAccess(
      previous?.status === "confirmed" ? (previous.value as string | null) : null,
      input.status === "confirmed" ? (input.value as string) : null,
      input.access,
      input.actorLabel,
    );
  }
  return row!;
}

/**
 * The brief says the CEO and COO work with Sam directly. When a leadership account is confirmed,
 * grant that person Sam access on the existing Access policies (system grants have no creator);
 * when it changes, remove only the system grants for the previous person.
 */
const LEADERSHIP_SAM_ACCESS = [
  "use_via_baxter",
  "direct_chat",
  "restricted_data",
  "view_activity",
  "approve",
] as const;

async function syncLeadershipSamAccess(
  previousUserId: string | null,
  nextUserId: string | null,
  access: OpsAccess,
  actorLabel: string,
) {
  if (previousUserId === nextUserId) return;
  const { ensureWorkforceSeed } = await import("@/lib/agents/seed");
  await ensureWorkforceSeed();
  const sam = await selectOne<{ id: string }>("ai_agents", { filters: [eq("slug", "sam")] });
  if (!sam) return;
  if (previousUserId) {
    const roles = await getOpsRoles();
    // Keep access if the same person still holds the other leadership role.
    if (roles.ceo !== previousUserId && roles.coo !== previousUserId) {
      await agentDb().remove("ai_agent_access_policies", [
        eq("agent_id", sam.id),
        eq("principal_type", "user"),
        eq("principal_value", previousUserId),
        { col: "created_by", op: "is_null" },
      ]);
    }
  }
  if (nextUserId) {
    for (const level of LEADERSHIP_SAM_ACCESS) {
      try {
        await agentDb().insert("ai_agent_access_policies", {
          agent_id: sam.id,
          principal_type: "user",
          principal_value: nextUserId,
          access_level: level,
          created_by: null,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }
  await recordAudit({
    actor: { userId: access.userId, label: actorLabel },
    action: "ops.leadership_access_synced",
    targetType: "ops_decision",
    targetId: null,
    summary: "Updated Sam access for the confirmed CEO/COO accounts.",
    details: {
      granted: nextUserId ? [...LEADERSHIP_SAM_ACCESS] : [],
      removedFor: previousUserId ? "previous leader" : null,
    },
  });
}

export async function updateEntity(
  id: string,
  patch: Partial<Pick<EntityRow, "name" | "confirmed" | "active">>,
  access: OpsAccess,
  actorLabel: string,
) {
  requireOps(access, "sensitive");
  const [row] = await agentDb().update<EntityRow>("ops_entities", [eq("id", id)], patch);
  await recordAudit({
    actor: { userId: access.userId, label: actorLabel },
    action: "ops.entity_changed",
    targetType: "ops_entity",
    targetId: id,
    summary: `Legal entity ${row?.name ?? id} updated.`,
    details: patch,
  });
  return row;
}
