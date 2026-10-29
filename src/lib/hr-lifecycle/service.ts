/**
 * HR lifecycle service (server). Builds on Sam Operations: lifecycle templates are ordinary
 * versioned ops workflows, cases are ops workflow instances (CEO/COO approval to start), and
 * tasks are ops steps. This module adds what the checklist needs on top:
 *
 *   - seeding the three templates, platforms, compliance calendar, communication templates, and
 *     verification register from the structured checklist (drafts; nothing goes live by itself)
 *   - previewing and starting cases from existing employee records (the wizard)
 *   - the seven task statuses with integrity checks, and per-task history
 *   - the access register, verification register, and source-document versions
 *
 * Privacy: case labels and audit summaries never contain names; the employee is reached through
 * person_id by viewers who may see HR records. Nothing here sends a message, changes payroll, or
 * changes an account — those stay human tasks or approval-bound ops actions.
 */

import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, inList, isUniqueViolation, selectOne } from "@/lib/agents/store";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import type { WorkflowDefinition } from "@/lib/ops/definition";
import type { ActionRow } from "@/lib/ops/actions";
import {
  advanceInstance,
  canActOnStep,
  completeStep,
  getInstanceDetail,
  getTemplateDetail,
  saveDraft,
  startWorkflow,
  type InstanceRow,
  type StepRow,
  type TemplateRow,
  type VersionRow,
} from "@/lib/ops/engine";
import { decisionValue, getOpsRoles, requireOps, type OpsAccess } from "@/lib/ops/org";
import { CHECKLIST_CATALOG, CHECKLIST_KEY, CHECKLIST_TITLE, CHECKLIST_VERSION } from "./catalog";
import { DEFAULT_COMMUNICATIONS, type CommunicationTemplate } from "./communications";
import { buildLifecyclePlan, type LifecyclePlan, type VerificationState } from "./plan";
import { PLATFORMS, isPrivilegedRole, platformLabel } from "./platforms";
import {
  canTransition,
  displayStatus,
  isIsoDate,
  transitionError,
  type LifecycleTransition,
} from "./rules";
import {
  catalogForNewVersion,
  parseChecklistDocx,
  reconcile,
  type Reconciliation,
} from "./source-document";
import {
  LIFECYCLE_TEMPLATE_KEYS,
  LIFECYCLE_TEMPLATE_NAMES,
  applyItemEdits,
  changedComplianceItems,
  definitionFromCatalog,
  itemsFromDefinition,
  templateDescription,
  type ItemEdit,
} from "./templates";
import {
  LIFECYCLE_PHASES,
  PHASE_LABELS,
  type ChecklistCatalog,
  type LifecycleDates,
  type LifecycleItem,
  type LifecyclePhase,
  type LifecycleProfile,
  type PlatformKey,
  type RoleKey,
  type SeparationType,
} from "./types";

const AUDIT_TARGET = "ops_lifecycle";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type SourceRow = {
  id: string;
  document_key: string;
  version_label: string;
  title: string;
  document_date: string | null;
  filename: string | null;
  content_hash: string;
  knowledge_document_id: string | null;
  status: "current" | "superseded";
  supersedes_id: string | null;
  item_count: number;
  reconciliation: Partial<Reconciliation> & { summary?: string };
  note: string;
  imported_by: string | null;
  created_at: string;
};

export type EventRow = {
  id: string;
  instance_id: string;
  step_id: string | null;
  item_id: string | null;
  event: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  actor_profile_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type VerificationRow = {
  id: string;
  item_id: string;
  document_key: string;
  document_version: string;
  original_text: string;
  citation: string;
  authority: string;
  status: VerificationState;
  reviewer_profile_id: string | null;
  reviewed_at: string | null;
  official_source_url: string | null;
  official_source_title: string | null;
  official_text: string | null;
  discrepancy: string | null;
  note: string;
  history: Array<{ at: string; by: string | null; status: string; note: string }>;
};

export type PlatformRow = {
  key: string;
  label: string;
  licensed_seat: boolean;
  seats_total: number | null;
  seats_used: number | null;
  seat_cost: string | null;
  seat_cost_source: string | null;
  owner_profile_id: string | null;
  notes: string;
};

export type GrantRow = {
  id: string;
  person_id: string;
  platform: string;
  role: string;
  privileged: boolean;
  status: "active" | "revoked";
  granted_on: string;
  approver_profile_id: string;
  approval_note: string;
  instance_id: string | null;
  step_id: string | null;
  revoked_on: string | null;
  revoked_by: string | null;
  revocation_verified_at: string | null;
  revocation_verified_by: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
};

export type CommTemplateRow = {
  id: string;
  key: string;
  version: number;
  status: "active" | "superseded";
  name: string;
  channel: "email" | "slack";
  subject: string;
  body: string;
  change_summary: string;
  created_by: string | null;
  created_at: string;
};

type PersonRow = {
  id: string;
  full_name: string;
  position: string | null;
  department: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  profile_id: string | null;
  manager_profile_id: string | null;
  bamboohr_id: string | null;
  test_record: boolean;
  entity_id: string | null;
};

/** Stored on ops_workflow_instances.lifecycle — facts and dates only, never names or contacts. */
export type CaseSummary = {
  phase: LifecyclePhase;
  reference: string;
  documentKey: string;
  documentVersion: string;
  templateVersion: number;
  profile: LifecycleProfile;
  dates: LifecycleDates;
  missingInfo: string[];
  missingApprovals: string[];
  notes: string[];
  legalItems: number;
  notApplicable: number;
  licenseNeeds: string[];
};

export type LifecycleSettings = {
  /** Days before a due date to raise an in-app "due soon" reminder. */
  leadDays: number;
  /** External notifications stay off until leadership enables them and owners are set. */
  external: { enabled: boolean; channel: "slack" | null; enabledBy: string | null };
};

const SETTINGS_KEY = "hr_lifecycle";
export const DEFAULT_SETTINGS: LifecycleSettings = {
  leadDays: 2,
  external: { enabled: false, channel: null, enabledBy: null },
};

const actor = (a: OpsAccess, label: string) => ({ userId: a.userId, label });

async function recordEvent(e: {
  instanceId: string;
  stepId: string | null;
  itemId: string | null;
  event: string;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  access: OpsAccess | null;
  actorLabel: string;
}) {
  await agentDb().insert("ops_lifecycle_events", {
    instance_id: e.instanceId,
    step_id: e.stepId,
    item_id: e.itemId,
    event: e.event,
    from_status: e.from ?? null,
    to_status: e.to ?? null,
    note: e.note ? e.note.slice(0, 2000) : null,
    actor_profile_id: e.access?.userId ?? null,
    actor_label: e.actorLabel.slice(0, 160),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function getLifecycleSettings(): Promise<LifecycleSettings> {
  const row = await selectOne<{ config: Partial<LifecycleSettings> }>("ops_integration_settings", {
    filters: [eq("key", SETTINGS_KEY)],
  });
  const c = row?.config ?? {};
  return {
    leadDays:
      typeof c.leadDays === "number" && c.leadDays >= 0 && c.leadDays <= 30
        ? c.leadDays
        : DEFAULT_SETTINGS.leadDays,
    external: {
      enabled: Boolean(c.external?.enabled),
      channel: c.external?.channel === "slack" ? "slack" : null,
      enabledBy: c.external?.enabledBy ?? null,
    },
  };
}

/** Only leadership turns external reminders on, and only with a channel. */
export async function saveLifecycleSettings(input: {
  leadDays: number;
  externalEnabled: boolean;
  access: OpsAccess;
  actorLabel: string;
}): Promise<LifecycleSettings> {
  requireOps(input.access, input.externalEnabled ? "leadership" : "configure");
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 30)
    throw new ValidationError("Reminder lead time must be 0 to 30 days.");
  const next: LifecycleSettings = {
    leadDays: input.leadDays,
    external: input.externalEnabled
      ? { enabled: true, channel: "slack", enabledBy: input.access.userId }
      : { enabled: false, channel: null, enabledBy: null },
  };
  const existing = await selectOne("ops_integration_settings", {
    filters: [eq("key", SETTINGS_KEY)],
  });
  if (existing)
    await agentDb().update("ops_integration_settings", [eq("key", SETTINGS_KEY)], {
      config: next,
      updated_by: input.access.userId,
    });
  else
    await agentDb().insert("ops_integration_settings", {
      key: SETTINGS_KEY,
      config: next,
      updated_by: input.access.userId,
    });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_settings",
    targetType: AUDIT_TARGET,
    summary: `Lifecycle reminders: ${input.leadDays} day lead; external notifications ${next.external.enabled ? "on (Slack, approval-bound)" : "off"}.`,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Seeding (idempotent; never overwrites admin edits)
// ---------------------------------------------------------------------------
export async function ensureLifecycleSetup(access: OpsAccess | null): Promise<void> {
  for (const phase of LIFECYCLE_PHASES) {
    const key = LIFECYCLE_TEMPLATE_KEYS[phase];
    if (await selectOne("ops_workflow_templates", { filters: [eq("key", key)] })) continue;
    try {
      const [t] = await agentDb().insert<TemplateRow>("ops_workflow_templates", {
        key,
        name: LIFECYCLE_TEMPLATE_NAMES[phase],
        category: phase === "offboarding" ? "offboarding" : "onboarding",
        description: templateDescription(phase, CHECKLIST_VERSION),
        status: "draft",
        official: true,
        published_version_id: null,
        created_by: access?.userId ?? null,
      });
      await agentDb().insert("ops_workflow_versions", {
        template_id: t!.id,
        version: 1,
        status: "draft",
        definition: definitionFromCatalog(phase),
        change_summary: `Built from the leadership checklist (document version ${CHECKLIST_VERSION})`,
        created_by: access?.userId ?? null,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  const platforms = new Set(
    (await agentDb().select<PlatformRow>("ops_software_platforms", {})).map((p) => p.key),
  );
  for (const p of PLATFORMS) {
    if (platforms.has(p.key)) continue;
    await agentDb()
      .insert("ops_software_platforms", {
        key: p.key,
        label: p.label,
        licensed_seat: p.licensedSeat,
        seats_total: null,
        seats_used: null,
        seat_cost: null,
        seat_cost_source: null,
        owner_profile_id: null,
        notes: p.adminNote,
      })
      .catch((e) => {
        if (!isUniqueViolation(e)) throw e;
      });
  }
  const calendar = new Set(
    (await agentDb().select<{ key: string }>("ops_compliance_calendar", {})).map((r) => r.key),
  );
  for (const r of CHECKLIST_CATALOG.recurring) {
    if (calendar.has(r.id)) continue;
    await agentDb()
      .insert("ops_compliance_calendar", {
        key: r.id,
        item: r.item,
        when_text: r.when,
        requirement: r.requirement,
        tags: r.tags,
        cadence: r.cadence,
        verified_dates: [],
        owner_role: r.defaultOwner,
        owner_profile_id: null,
        active: true,
      })
      .catch((e) => {
        if (!isUniqueViolation(e)) throw e;
      });
  }
  const comms = new Set(
    (await agentDb().select<CommTemplateRow>("ops_comm_templates", {})).map((r) => r.key),
  );
  for (const t of DEFAULT_COMMUNICATIONS) {
    if (comms.has(t.key)) continue;
    await agentDb()
      .insert("ops_comm_templates", {
        key: t.key,
        version: 1,
        status: "active",
        name: t.name,
        channel: t.channel,
        subject: t.subject,
        body: t.body,
        change_summary: "Default draft template",
        created_by: null,
      })
      .catch((e) => {
        if (!isUniqueViolation(e)) throw e;
      });
  }
  await ensureVerificationRows(CHECKLIST_CATALOG);
}

/** One register row per legal item citation (or one row for an uncited legal item). */
export async function ensureVerificationRows(catalog: ChecklistCatalog): Promise<number> {
  const existing = new Set(
    (
      await agentDb().select<VerificationRow>("ops_compliance_verifications", {
        filters: [eq("document_version", catalog.documentVersion)],
      })
    ).map((r) => `${r.item_id}|${r.citation}`),
  );
  let added = 0;
  const rows: Array<{ itemId: string; text: string; citation: string; authority: string }> = [];
  for (const i of catalog.items.filter((x) => x.tags.length)) {
    const cites = i.citations.length
      ? i.citations
      : [{ reference: "No citation in the document", authority: "Legislature" }];
    for (const c of cites)
      rows.push({ itemId: i.id, text: i.text, citation: c.reference, authority: c.authority });
  }
  for (const r of catalog.recurring.filter((x) => x.tags.length)) {
    const cites = r.citations.length
      ? r.citations
      : [{ reference: r.requirement, authority: "Legislature" as const }];
    for (const c of cites)
      rows.push({
        itemId: r.id,
        text: `${r.item} — ${r.when} — ${r.requirement}`,
        citation: c.reference,
        authority: c.authority,
      });
  }
  for (const r of rows) {
    if (existing.has(`${r.itemId}|${r.citation}`)) continue;
    try {
      await agentDb().insert("ops_compliance_verifications", {
        item_id: r.itemId,
        document_key: catalog.documentKey,
        document_version: catalog.documentVersion,
        original_text: r.text,
        citation: r.citation,
        authority: r.authority,
        status: "unverified",
        note: "",
        history: [],
      });
      added++;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return added;
}

/** Called by the engine when a lifecycle template version is published. */
export async function onLifecycleVersionPublished(
  prev: WorkflowDefinition | null,
  next: WorkflowDefinition,
  userId: string | null,
): Promise<void> {
  if (!prev) return;
  const changed = changedComplianceItems(prev, next);
  if (!changed.length) return;
  const rows = await agentDb().select<VerificationRow>("ops_compliance_verifications", {
    filters: [inList("item_id", changed)],
  });
  const at = new Date().toISOString();
  for (const r of rows.filter((x) => x.status !== "unverified")) {
    await agentDb().update("ops_compliance_verifications", [eq("id", r.id)], {
      status: "unverified",
      history: [
        ...r.history,
        {
          at,
          by: userId,
          status: "unverified",
          note: `Item edited in a published workflow version; re-verify. Previous status: ${r.status}.`,
        },
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// Templates and items
// ---------------------------------------------------------------------------
export async function lifecycleTemplate(phase: LifecyclePhase) {
  const t = await selectOne<TemplateRow>("ops_workflow_templates", {
    filters: [eq("key", LIFECYCLE_TEMPLATE_KEYS[phase])],
  });
  if (!t) throw new NotFoundError(`The ${PHASE_LABELS[phase]} template has not been set up yet.`);
  const { versions } = await getTemplateDetail(t.id);
  return {
    template: t,
    versions,
    published: versions.find((v) => v.id === t.published_version_id) ?? null,
    latest: versions[0] ?? null,
  };
}

/** No-code edits to checklist items, saved as a draft version (publishing is a separate step). */
export async function saveItemEdits(input: {
  phase: LifecyclePhase;
  edits: ItemEdit[];
  changeSummary: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  if (!input.edits.length) throw new ValidationError("Nothing to save.");
  const { template, latest } = await lifecycleTemplate(input.phase);
  if (!latest) throw new NotFoundError("No version to edit.");
  let next: WorkflowDefinition;
  try {
    next = applyItemEdits(latest.definition, input.edits);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Invalid edit.");
  }
  const result = await saveDraft({
    templateId: template.id,
    definition: next,
    changeSummary: input.changeSummary,
    access: input.access,
    actorLabel: input.actorLabel,
  });
  const compliance = changedComplianceItems(latest.definition, next);
  return { ...result, complianceItemsChanged: compliance };
}

// ---------------------------------------------------------------------------
// Wizard: preview and start
// ---------------------------------------------------------------------------
export type CaseInput = {
  phase: LifecyclePhase;
  personId: string;
  roles: RoleKey[];
  rolesConfirmed: boolean;
  exempt: boolean | null;
  supervisor: boolean | null;
  onGroupHealth: boolean | null;
  separation: SeparationType | null;
  dates: LifecycleDates;
  hiringManagerProfileId: string | null;
};

async function headcount(): Promise<number | null> {
  const v = await decisionValue("company_headcount");
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

async function verificationMap(): Promise<Record<string, VerificationState>> {
  const rows = await agentDb().select<VerificationRow>("ops_compliance_verifications", {});
  const out: Record<string, VerificationState> = {};
  for (const r of rows) {
    const prev = out[r.item_id];
    // An item is verified only when every citation row is verified; any discrepancy wins.
    if (r.status === "discrepancy" || prev === "discrepancy") out[r.item_id] = "discrepancy";
    else if (r.status === "unverified" || prev === "unverified") out[r.item_id] = "unverified";
    else out[r.item_id] = "verified";
  }
  return out;
}

export async function activeCommunications(): Promise<CommunicationTemplate[]> {
  const rows = await agentDb().select<CommTemplateRow>("ops_comm_templates", {
    filters: [eq("status", "active")],
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return DEFAULT_COMMUNICATIONS.map((d) => {
    const r = byKey.get(d.key);
    return r ? { ...d, name: r.name, channel: r.channel, subject: r.subject, body: r.body } : d;
  });
}

async function seatInfo() {
  const rows = await agentDb().select<PlatformRow>("ops_software_platforms", {});
  return Object.fromEntries(
    rows.map((r) => [
      r.key,
      { seatsTotal: r.seats_total, seatsUsed: r.seats_used, seatCost: r.seat_cost },
    ]),
  ) as Partial<
    Record<
      PlatformKey,
      { seatsTotal: number | null; seatsUsed: number | null; seatCost: string | null }
    >
  >;
}

function validateCaseInput(input: CaseInput) {
  for (const [k, v] of Object.entries(input.dates))
    if (v && !isIsoDate(v)) throw new ValidationError(`${k.replace(/_/g, " ")} must be a date.`);
  if (input.phase === "offboarding" && input.dates.notice_date && input.dates.last_day)
    if (input.dates.last_day < input.dates.notice_date)
      throw new ValidationError("The last day can't be before the notice date.");
  if (input.phase !== "offboarding" && input.dates.offer_date && input.dates.start_date)
    if (input.dates.start_date < input.dates.offer_date)
      throw new ValidationError("The start date can't be before the offer date.");
}

/** The wizard's preview: everything the case would contain, before anything is created. */
export async function previewCase(
  input: CaseInput,
  access: OpsAccess,
): Promise<{
  plan: LifecyclePlan;
  templateVersion: number | null;
  published: boolean;
  person: { id: string; firstName: string; position: string | null; testRecord: boolean };
}> {
  requireOps(access, "viewAll");
  validateCaseInput(input);
  const person = await selectOne<PersonRow>("ops_people", { filters: [eq("id", input.personId)] });
  if (!person) throw new NotFoundError("Employee record not found.");
  const { published, latest } = await lifecycleTemplate(input.phase);
  const def = (published ?? latest)!.definition;
  const roles = await getOpsRoles();
  const managerId = input.hiringManagerProfileId ?? person.manager_profile_id;
  const managerName = managerId
    ? ((
        await import("@/lib/research/report-store").then((m) => m.getReportStore().listProfiles())
      ).find((p) => p.id === managerId)?.full_name ?? null)
    : null;
  const plan = buildLifecyclePlan({
    phase: input.phase,
    items: itemsFromDefinition(def),
    profile: {
      roles: [...new Set(input.roles)],
      rolesConfirmed: input.rolesConfirmed,
      exempt: input.exempt,
      supervisor: input.supervisor,
      headcount: await headcount(),
      onGroupHealth: input.onGroupHealth,
      separation: input.phase === "offboarding" ? input.separation : null,
    },
    dates: input.dates,
    verification: await verificationMap(),
    seats: await seatInfo(),
    communications: await activeCommunications(),
    mergeValues: {
      first_name: person.full_name.split(/\s+/)[0] ?? "",
      manager_name: managerName,
    },
    ownersConfigured: {
      ceo: Boolean(roles.ceo),
      coo: Boolean(roles.coo),
      leadership: Boolean(roles.ceo || roles.coo),
      hr_admin: roles.hrAdmins.length > 0,
      finance_owner: Boolean(roles.financeOwner),
      tech_ops_manager: Boolean(roles.techOpsManager),
      hiring_manager: Boolean(managerId),
    },
  });
  if (!published)
    plan.missingApprovals.unshift(
      `Publish the ${PHASE_LABELS[input.phase]} template (CEO or COO) before a case can start`,
    );
  return {
    plan,
    templateVersion: (published ?? latest)?.version ?? null,
    published: Boolean(published),
    person: {
      id: person.id,
      firstName: person.full_name.split(/\s+/)[0] ?? "",
      position: person.position,
      testRecord: person.test_record,
    },
  };
}

function caseReference(): string {
  return `LC-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Start a case: the plan above becomes an ops workflow instance pinned to the published
 * template version. It waits for a CEO/COO approval before any task begins; offboarding also
 * has an explicit authorization task first.
 */
export async function startCase(input: {
  case: CaseInput;
  mode: "live" | "test";
  reason: string;
  idempotencyKey?: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<{ instance: InstanceRow; plan: LifecyclePlan }> {
  requireOps(input.access, "viewAll");
  const c = input.case;
  const preview = await previewCase(c, input.access);
  if (!preview.published)
    throw new ValidationError(
      `The ${PHASE_LABELS[c.phase]} template isn't published yet. Leadership publishes it from Templates.`,
    );
  if (input.mode === "live" && preview.person.testRecord)
    throw new ValidationError("Synthetic (test) employee records can only start test cases.");
  if (c.phase === "offboarding" && !c.separation)
    throw new ValidationError("Choose the separation type.");
  if (c.phase === "offboarding" && ["involuntary", "layoff"].includes(c.separation ?? "")) {
    if (input.reason.trim().length < 20)
      throw new ValidationError(
        "Immediate or involuntary departures need a written reason for leadership (at least 20 characters). Leadership must also authorize the separation.",
      );
  }
  const { template, published } = await lifecycleTemplate(c.phase);
  const plan = preview.plan;
  const reference = caseReference();
  const stepOverrides: Parameters<typeof startWorkflow>[0]["stepOverrides"] = {};
  for (const item of plan.items) {
    stepOverrides[item.itemId] = item.included
      ? {
          dueAt: item.due,
          checklist: item.subItems.filter((s) => s.included).map((s) => s.text.slice(0, 200)),
          data: {
            inclusion: { included: true, reasons: item.reasons, unknown: item.unknownFacts },
            excludedSubItems: item.subItems
              .filter((s) => !s.included)
              .map((s) => ({ text: s.text, reasons: s.reasons })),
            dueNote: item.dueNote,
            legalVerification: item.verification,
            flags: item.flags,
            ...(plan.drafts.find((d) => d.itemId === item.itemId)
              ? { draft: plan.drafts.find((d) => d.itemId === item.itemId) }
              : {}),
          },
        }
      : {
          status: "not_applicable",
          dueAt: null,
          data: {
            inclusion: { included: false, reasons: item.reasons, unknown: item.unknownFacts },
            notApplicable: {
              reason: `Not included when the case started: ${item.reasons.filter(Boolean).join(" ")}`,
              by: null,
              at: new Date().toISOString(),
            },
          },
        };
  }
  const dates = c.dates;
  const summary: CaseSummary = {
    phase: c.phase,
    reference,
    documentKey: published!.definition.lifecycle?.documentKey ?? CHECKLIST_KEY,
    documentVersion: published!.definition.lifecycle?.documentVersion ?? CHECKLIST_VERSION,
    templateVersion: published!.version,
    profile: {
      roles: [...new Set(c.roles)],
      rolesConfirmed: c.rolesConfirmed,
      exempt: c.exempt,
      supervisor: c.supervisor,
      headcount: await headcount(),
      onGroupHealth: c.onGroupHealth,
      separation: c.phase === "offboarding" ? c.separation : null,
    },
    dates,
    missingInfo: plan.missingInfo,
    missingApprovals: plan.missingApprovals,
    notes: plan.notes,
    legalItems: plan.counts.legal,
    notApplicable: plan.counts.notApplicable,
    licenseNeeds: plan.licenseNeeds.map((l) => l.label),
  };
  const engineInputs: Record<string, string> =
    c.phase === "offboarding"
      ? {
          notice_date: dates.notice_date ?? "",
          end_date: dates.last_day ?? "",
          separation_type: c.separation ?? "",
          ...(c.hiringManagerProfileId ? { hiring_manager: c.hiringManagerProfileId } : {}),
        }
      : {
          offer_date: dates.offer_date ?? "",
          start_date: dates.start_date ?? "",
          ...(c.hiringManagerProfileId ? { hiring_manager: c.hiringManagerProfileId } : {}),
        };
  const person = (await selectOne<PersonRow>("ops_people", {
    filters: [eq("id", c.personId)],
  }))!;
  const instance = await startWorkflow({
    templateId: template.id,
    entityId: person.entity_id,
    personId: person.id,
    subjectLabel: `${PHASE_LABELS[c.phase]} case ${reference}`,
    inputs: engineInputs,
    mode: input.mode,
    reason: input.reason || (input.mode === "test" ? "Test case with a synthetic record" : ""),
    idempotencyKey: input.idempotencyKey,
    access: input.access,
    actorLabel: input.actorLabel,
    stepOverrides,
    extra: { lifecycle: summary },
  });
  const created = (await getInstanceDetail(instance.id)).steps;
  for (const s of created) {
    await recordEvent({
      instanceId: instance.id,
      stepId: s.id,
      itemId: s.step_key,
      event: s.status === "not_applicable" ? "excluded" : "created",
      to: s.status,
      note:
        s.status === "not_applicable"
          ? String((s.data.notApplicable as { reason?: string } | undefined)?.reason ?? "")
          : `Included: ${((s.data.inclusion as { reasons?: string[] } | undefined)?.reasons ?? []).join(" ")}`,
      access: input.access,
      actorLabel: input.actorLabel,
    });
  }
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_case_requested",
    targetType: AUDIT_TARGET,
    targetId: instance.id,
    summary: `Requested ${PHASE_LABELS[c.phase].toLowerCase()} case ${reference} (${input.mode}); waiting for CEO/COO approval.`,
  });
  return { instance, plan };
}

// ---------------------------------------------------------------------------
// Task status changes (status integrity) and notes
// ---------------------------------------------------------------------------
async function loadStep(stepId: string) {
  const step = await selectOne<StepRow>("ops_workflow_steps", { filters: [eq("id", stepId)] });
  if (!step || !step.config.lifecycle) throw new NotFoundError("Checklist task not found.");
  const instance = (await selectOne<InstanceRow>("ops_workflow_instances", {
    filters: [eq("id", step.instance_id)],
  }))!;
  return { step, instance };
}

export async function changeTaskStatus(input: {
  stepId: string;
  transition: LifecycleTransition;
  note?: string;
  evidenceUrl?: string;
  checklistDone?: string[];
  access: OpsAccess;
  actorLabel: string;
}): Promise<void> {
  const { step, instance } = await loadStep(input.stepId);
  if (!["active", "paused"].includes(instance.status))
    throw new ValidationError(
      instance.status === "pending_approval"
        ? "This case is waiting for CEO/COO approval to start."
        : `This case is ${instance.status}.`,
    );
  if (!canTransition(step.status, input.transition))
    throw new ValidationError(transitionError(step.status, input.transition));
  const note = input.note?.trim() ?? "";
  const item = step.config.lifecycle!;
  const now = new Date().toISOString();
  const base = {
    instanceId: instance.id,
    stepId: step.id,
    itemId: item.id,
    access: input.access,
    actorLabel: input.actorLabel,
  };

  switch (input.transition) {
    case "complete": {
      await completeStep({
        stepId: step.id,
        access: input.access,
        actorLabel: input.actorLabel,
        note: note || undefined,
        evidenceUrl: input.evidenceUrl,
        checklistDone: input.checklistDone,
      });
      await recordEvent({ ...base, event: "completed", from: step.status, to: "completed", note });
      return;
    }
    case "send_to_external_verification": {
      if (!canActOnStep(step, input.access))
        throw new AuthorizationError("This task is assigned to someone else.");
      if (note.length < 5)
        throw new ValidationError(
          'Say which system holds the record and what needs confirming (for example, "I-9 in BambooHR, waiting for HR review").',
        );
      await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
        status: "external_verification",
        data: { ...step.data, externalVerification: { note, by: input.access.userId, at: now } },
      });
      await recordEvent({
        ...base,
        event: "external_verification_requested",
        from: step.status,
        to: "external_verification",
        note,
      });
      return;
    }
    case "confirm_external_verification": {
      if (!(
        input.access.isLeadership ||
        input.access.isHrAdmin ||
        canActOnStep(step, input.access)
      ))
        throw new AuthorizationError("Only HR, leadership, or the task owner can confirm this.");
      if (!note && !input.evidenceUrl?.trim())
        throw new ValidationError("Add what you checked (a note or a link) to confirm.");
      await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
        status: "completed",
        completed_by: input.access.userId,
        completed_at: now,
        evidence: [
          ...step.evidence,
          ...(note
            ? [{ kind: "note", value: note.slice(0, 1000), by: input.access.userId, at: now }]
            : []),
          ...(input.evidenceUrl?.trim()
            ? [
                {
                  kind: "link",
                  value: input.evidenceUrl.trim().slice(0, 500),
                  by: input.access.userId,
                  at: now,
                },
              ]
            : []),
        ],
      });
      await recordEvent({
        ...base,
        event: "external_verification_confirmed",
        from: "external_verification",
        to: "completed",
        note: note || input.evidenceUrl || "",
      });
      await advanceInstance(instance.id);
      return;
    }
    case "mark_not_applicable": {
      if (note.length < 5) throw new ValidationError("Explain why this task doesn't apply.");
      if (item.tags.length && !input.access.isLeadership)
        throw new AuthorizationError(
          "Legal ([CA]/[Fed]) tasks can only be marked N/A by the CEO or COO, with a reason.",
        );
      if (step.type === "access_request" && !(input.access.isCoo || input.access.isLeadership))
        throw new AuthorizationError("Only the COO or CEO can mark an access task N/A.");
      if (step.type === "approval")
        throw new ValidationError("An authorization step can't be marked N/A.");
      requireOps(input.access, "viewAll");
      await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
        status: "not_applicable",
        override_reason: note.slice(0, 500),
        completed_by: input.access.userId,
        completed_at: now,
        data: { ...step.data, notApplicable: { reason: note, by: input.access.userId, at: now } },
      });
      await recordEvent({
        ...base,
        event: "marked_not_applicable",
        from: step.status,
        to: "not_applicable",
        note,
      });
      await advanceInstance(instance.id);
      return;
    }
    case "reopen": {
      requireOps(input.access, "viewAll");
      if (note.length < 5) throw new ValidationError("Explain why the task is being reopened.");
      if (item.tags.length && step.status === "not_applicable" && !input.access.isLeadership)
        throw new AuthorizationError("Only the CEO or COO can reopen a legal task marked N/A.");
      await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
        status: "blocked",
        completed_by: null,
        completed_at: null,
        override_reason: null,
      });
      await recordEvent({ ...base, event: "reopened", from: step.status, to: "blocked", note });
      await advanceInstance(instance.id);
      return;
    }
  }
}

export async function addTaskNote(input: {
  stepId: string;
  note: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  const { step, instance } = await loadStep(input.stepId);
  if (!(input.access.canViewAll || canActOnStep(step, input.access)))
    throw new AuthorizationError("You can only add notes to your own tasks.");
  const note = input.note.trim();
  if (note.length < 2) throw new ValidationError("Write a note.");
  await recordEvent({
    instanceId: instance.id,
    stepId: step.id,
    itemId: step.step_key,
    event: "note",
    note,
    access: input.access,
    actorLabel: input.actorLabel,
  });
}

/** Edit a case's draft communication (it stays a draft; nothing is sent). */
export async function updateCaseDraft(input: {
  stepId: string;
  subject: string;
  body: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "viewAll");
  const { step, instance } = await loadStep(input.stepId);
  const draft = step.data.draft as Record<string, unknown> | undefined;
  if (!draft) throw new ValidationError("This task has no draft communication.");
  await agentDb().update("ops_workflow_steps", [eq("id", step.id)], {
    data: {
      ...step.data,
      draft: {
        ...draft,
        subject: input.subject.slice(0, 300),
        body: input.body.slice(0, 10_000),
        editedAt: new Date().toISOString(),
        editedBy: input.access.userId,
      },
    },
  });
  await recordEvent({
    instanceId: instance.id,
    stepId: step.id,
    itemId: step.step_key,
    event: "draft_edited",
    note: "Draft communication edited (not sent).",
    access: input.access,
    actorLabel: input.actorLabel,
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export type CaseTask = {
  stepId: string;
  itemId: string;
  title: string;
  text: string;
  section: string;
  part: string;
  ordinal: number;
  tags: string[];
  citations: string[];
  owner: string;
  assigneeProfileId: string | null;
  due: string | null;
  status: string;
  display: ReturnType<typeof displayStatus>;
  stepType: string;
  dependsOn: string[];
  blockedBy: string[];
  evidence: StepRow["evidence"];
  checklist: string[];
  inclusionReasons: string[];
  flags: string[];
  verification: VerificationState | null;
  draft: { subject: string; body: string; missing: string[]; name: string; channel: string } | null;
  approvals: Array<{ id: string; title: string; status: string; createdAt: string }>;
  history: Array<{ at: string; event: string; note: string | null; by: string | null }>;
  documentVersion: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Cases the viewer may see, with progress and status counts. Never includes contact details. */
export async function listCases(access: OpsAccess) {
  const instances = await agentDb().select<InstanceRow & { lifecycle: CaseSummary | null }>(
    "ops_workflow_instances",
    { order: { col: "created_at", ascending: false }, limit: 500 },
  );
  const lifecycle = instances.filter((i) => i.lifecycle);
  if (!lifecycle.length) return [];
  const steps = await agentDb().select<StepRow>("ops_workflow_steps", {
    filters: [
      inList(
        "instance_id",
        lifecycle.map((i) => i.id),
      ),
    ],
    limit: 20_000,
  });
  let visible = lifecycle;
  if (!access.canViewAll) {
    const mine = new Set(
      steps
        .filter((s) => s.assignee_profile_id && s.assignee_profile_id === access.userId)
        .map((s) => s.instance_id),
    );
    visible = lifecycle.filter((i) => mine.has(i.id));
  }
  const people = access.canViewAll
    ? new Map(
        (
          await agentDb().select<PersonRow>("ops_people", {
            filters: [inList("id", visible.map((i) => i.person_id).filter(Boolean) as string[])],
          })
        ).map((p) => [p.id, p]),
      )
    : new Map<string, PersonRow>();
  const t = today();
  return visible.map((i) => {
    const mine = steps.filter((s) => s.instance_id === i.id && s.status !== "cancelled");
    const counts: Record<string, number> = {};
    for (const s of mine) {
      const d = displayStatus(s, t);
      counts[d] = (counts[d] ?? 0) + 1;
    }
    const open = mine
      .filter((s) => !["completed", "skipped", "not_applicable"].includes(s.status))
      .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
    const applicable = mine.filter((s) => s.status !== "not_applicable" && s.status !== "skipped");
    const done = applicable.filter((s) => s.status === "completed").length;
    const person = i.person_id ? people.get(i.person_id) : undefined;
    return {
      id: i.id,
      reference: i.lifecycle!.reference,
      phase: i.lifecycle!.phase,
      status: i.status,
      mode: i.mode,
      personId: i.person_id,
      personName: person?.full_name ?? null,
      position: person?.position ?? null,
      testRecord: person?.test_record ?? false,
      roles: i.lifecycle!.profile.roles,
      dates: i.lifecycle!.dates,
      documentVersion: i.lifecycle!.documentVersion,
      templateVersion: i.lifecycle!.templateVersion,
      progress: applicable.length ? Math.round((done / applicable.length) * 100) : 0,
      counts,
      nextDue: open[0]?.due_at?.slice(0, 10) ?? null,
      nextTask: open[0]?.title ?? null,
      missingInfo: i.lifecycle!.missingInfo,
      createdAt: i.created_at,
    };
  });
}

/** One case, chronologically: every task with owner, due date, status, evidence, notes, history. */
export async function caseDetail(instanceId: string, access: OpsAccess) {
  const detail = await getInstanceDetail(instanceId);
  const inst = detail.instance as InstanceRow & { lifecycle: CaseSummary | null };
  if (!inst.lifecycle) throw new NotFoundError("This workflow is not a lifecycle case.");
  if (!access.canViewAll) {
    const mine = detail.steps.some((s) => s.assignee_profile_id === access.userId);
    if (!mine) throw new AuthorizationError("You can only see cases with tasks assigned to you.");
  }
  const events = await agentDb().select<EventRow>("ops_lifecycle_events", {
    filters: [eq("instance_id", instanceId)],
    order: { col: "created_at" },
  });
  const verification = await verificationMap();
  const t = today();
  const byKey = new Map(detail.steps.map((s) => [s.step_key, s]));
  const visibleSteps = access.canViewAll
    ? detail.steps
    : detail.steps.filter((s) => s.assignee_profile_id === access.userId);
  const tasks: CaseTask[] = visibleSteps.map((s) => {
    const item = s.config.lifecycle as LifecycleItem;
    const actions = detail.actions.filter((a: ActionRow) => a.step_id === s.id);
    const history = [
      ...events
        .filter((e) => e.step_id === s.id)
        .map((e) => ({ at: e.created_at, event: e.event, note: e.note, by: e.actor_label })),
      ...s.evidence.map((e) => ({
        at: e.at,
        event: `evidence:${e.kind}`,
        note: e.value,
        by: null,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const draft = (s.data.draft as CaseTask["draft"] | undefined) ?? null;
    return {
      stepId: s.id,
      itemId: s.step_key,
      title: s.title,
      text: item.text,
      section: item.sourceRef.section,
      part: item.sourceRef.part,
      ordinal: item.sourceRef.ordinal,
      tags: item.tags,
      citations: item.citations.map((c) => `${c.reference} (${c.authority})`),
      owner: s.assignee_role ?? item.owner,
      assigneeProfileId: s.assignee_profile_id,
      due: s.due_at?.slice(0, 10) ?? null,
      status: s.status,
      display: displayStatus(s, t),
      stepType: s.type,
      dependsOn: s.depends_on,
      blockedBy: s.depends_on.filter(
        (d) =>
          !["completed", "skipped", "not_applicable"].includes(byKey.get(d)?.status ?? "completed"),
      ),
      evidence: s.evidence,
      checklist: s.config.checklist,
      inclusionReasons: (
        (s.data.inclusion as { reasons?: string[] } | undefined)?.reasons ?? []
      ).filter(Boolean),
      flags: ((s.data.flags as string[] | undefined) ?? item.flags).slice(0, 10),
      verification: item.tags.length ? (verification[item.id] ?? "unverified") : null,
      draft,
      approvals: actions.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        createdAt: a.created_at,
      })),
      history,
      documentVersion: item.sourceRef.documentVersion,
    };
  });
  tasks.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.ordinal - b.ordinal);
  const person =
    access.canViewAll && inst.person_id
      ? await selectOne<PersonRow>("ops_people", { filters: [eq("id", inst.person_id)] })
      : null;
  return {
    case: {
      id: inst.id,
      reference: inst.lifecycle.reference,
      phase: inst.lifecycle.phase,
      status: inst.status,
      mode: inst.mode,
      summary: inst.lifecycle,
      person: person
        ? {
            id: person.id,
            name: person.full_name,
            position: person.position,
            testRecord: person.test_record,
          }
        : null,
      startApprovalId: inst.start_approval_id,
      templateVersion: detail.version?.version ?? null,
    },
    tasks,
  };
}

/** Management view: status totals, overdue by owner, upcoming legal deadlines, open risks. */
export async function managementSummary(access: OpsAccess) {
  requireOps(access, "viewAll");
  const cases = await listCases(access);
  const active = cases.filter((c) => ["active", "paused", "pending_approval"].includes(c.status));
  const steps = active.length
    ? await agentDb().select<StepRow>("ops_workflow_steps", {
        filters: [
          inList(
            "instance_id",
            active.map((c) => c.id),
          ),
        ],
        limit: 20_000,
      })
    : [];
  const t = today();
  const in14 = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const totals: Record<string, number> = {};
  const overdueByOwner: Record<string, number> = {};
  const upcomingLegal: Array<{
    caseId: string;
    reference: string;
    title: string;
    due: string;
    verification: string;
  }> = [];
  const verification = await verificationMap();
  for (const s of steps) {
    const d = displayStatus(s, t);
    totals[d] = (totals[d] ?? 0) + 1;
    if (d === "overdue")
      overdueByOwner[s.assignee_role ?? "unassigned"] =
        (overdueByOwner[s.assignee_role ?? "unassigned"] ?? 0) + 1;
    const item = s.config.lifecycle;
    if (
      item?.tags.length &&
      s.due_at &&
      s.due_at.slice(0, 10) <= in14 &&
      !["completed", "not_applicable", "skipped", "cancelled"].includes(s.status)
    ) {
      const c = active.find((x) => x.id === s.instance_id)!;
      upcomingLegal.push({
        caseId: c.id,
        reference: c.reference,
        title: s.title,
        due: s.due_at.slice(0, 10),
        verification: verification[item.id] ?? "unverified",
      });
    }
  }
  upcomingLegal.sort((a, b) => a.due.localeCompare(b.due));
  const [verRows, grants] = await Promise.all([
    agentDb().select<VerificationRow>("ops_compliance_verifications", {}),
    agentDb().select<GrantRow>("ops_access_grants", { filters: [eq("status", "active")] }),
  ]);
  return {
    caseCounts: {
      active: active.filter((c) => c.status === "active").length,
      awaitingStartApproval: active.filter((c) => c.status === "pending_approval").length,
      completed: cases.filter((c) => c.status === "completed").length,
    },
    totals,
    overdueByOwner,
    upcomingLegal: upcomingLegal.slice(0, 25),
    verification: {
      unverified: verRows.filter((r) => r.status === "unverified").length,
      verified: verRows.filter((r) => r.status === "verified").length,
      discrepancy: verRows.filter((r) => r.status === "discrepancy").length,
    },
    privilegedGrants: grants.filter((g) => g.privileged).length,
  };
}

// ---------------------------------------------------------------------------
// Verification register
// ---------------------------------------------------------------------------
const OFFICIAL_HOSTS = [
  "dir.ca.gov",
  "edd.ca.gov",
  "calcivilrights.ca.gov",
  "dhcs.ca.gov",
  "leginfo.legislature.ca.gov",
  "govt.westlaw.com",
  "oal.ca.gov",
  "uscis.gov",
  "e-verify.gov",
  "irs.gov",
  "dol.gov",
  "ecfr.gov",
  "federalregister.gov",
  "eeoc.gov",
  "cms.gov",
  "dmhc.ca.gov",
  "labor.ca.gov",
];

export function isOfficialSource(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * A named reviewer records the outcome of checking one legal item against an official DIR,
 * EDD, CRD, Cal/OSHA, DHCS, legislative, or federal source. The document's wording is never
 * changed here; a discrepancy is recorded next to it.
 */
export async function verifyRequirement(input: {
  id: string;
  status: "verified" | "discrepancy";
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialText?: string;
  discrepancy?: string;
  note?: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<VerificationRow> {
  requireOps(input.access, "viewAll");
  if (!input.access.userId) throw new AuthorizationError("A named reviewer is required.");
  const row = await selectOne<VerificationRow>("ops_compliance_verifications", {
    filters: [eq("id", input.id)],
  });
  if (!row) throw new NotFoundError("Verification entry not found.");
  if (!isOfficialSource(input.officialSourceUrl))
    throw new ValidationError(
      "Use an official government source (for example dir.ca.gov, edd.ca.gov, calcivilrights.ca.gov, uscis.gov, dol.gov, irs.gov, or leginfo.legislature.ca.gov) with an https link.",
    );
  if (!input.officialSourceTitle.trim())
    throw new ValidationError("Name the official page or document you checked.");
  if (input.status === "discrepancy" && !(input.discrepancy ?? "").trim())
    throw new ValidationError(
      "Describe the discrepancy between the checklist and the official source.",
    );
  const at = new Date().toISOString();
  const [updated] = await agentDb().update<VerificationRow>(
    "ops_compliance_verifications",
    [eq("id", row.id)],
    {
      status: input.status,
      reviewer_profile_id: input.access.userId,
      reviewed_at: at,
      official_source_url: input.officialSourceUrl.slice(0, 500),
      official_source_title: input.officialSourceTitle.slice(0, 300),
      official_text: (input.officialText ?? "").slice(0, 4000) || null,
      discrepancy: input.status === "discrepancy" ? (input.discrepancy ?? "").slice(0, 4000) : null,
      note: (input.note ?? "").slice(0, 2000),
      history: [
        ...row.history,
        {
          at,
          by: input.access.userId,
          status: input.status,
          note: `${input.officialSourceTitle} — ${input.officialSourceUrl}${input.discrepancy ? ` — Discrepancy: ${input.discrepancy}` : ""}`.slice(
            0,
            1000,
          ),
        },
      ],
    },
  );
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_verification",
    targetType: AUDIT_TARGET,
    targetId: row.id,
    summary: `${row.citation} (${row.item_id}): ${input.status}.`,
  });
  return updated!;
}

// ---------------------------------------------------------------------------
// Software access register
// ---------------------------------------------------------------------------
export async function savePlatform(input: {
  key: string;
  seatsTotal: number | null;
  seatsUsed: number | null;
  seatCost: string | null;
  seatCostSource: string | null;
  ownerProfileId: string | null;
  notes: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<PlatformRow> {
  requireOps(input.access, "configure");
  const row = await selectOne<PlatformRow>("ops_software_platforms", {
    filters: [eq("key", input.key)],
  });
  if (!row) throw new NotFoundError("Platform not found.");
  const cost = input.seatCost?.trim() || null;
  const source = input.seatCostSource?.trim() || null;
  if (cost && !source)
    throw new ValidationError(
      "Record where the seat cost comes from (invoice, contract, or admin console). Baxter never estimates prices.",
    );
  for (const n of [input.seatsTotal, input.seatsUsed])
    if (n !== null && (!Number.isInteger(n) || n < 0))
      throw new ValidationError("Seat counts must be whole numbers.");
  const [updated] = await agentDb().update<PlatformRow>(
    "ops_software_platforms",
    [eq("key", input.key)],
    {
      seats_total: input.seatsTotal,
      seats_used: input.seatsUsed,
      seat_cost: cost,
      seat_cost_source: cost ? source : null,
      owner_profile_id: input.ownerProfileId,
      notes: input.notes.slice(0, 1000),
      updated_by: input.access.userId,
    },
  );
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_platform",
    targetType: AUDIT_TARGET,
    summary: `Updated ${row.label} seats/cost record.`,
  });
  return updated!;
}

/**
 * Record an access grant (it happened outside Baxter; Sam never grants access). Every grant has
 * a named approver; privileged roles need the CEO or COO as approver — never inferred from a job
 * title — and only the COO or leadership can record grants.
 */
export async function recordGrant(input: {
  personId: string;
  platform: string;
  role: string;
  grantedOn: string;
  approverProfileId: string;
  approvalNote: string;
  instanceId?: string | null;
  stepId?: string | null;
  access: OpsAccess;
  actorLabel: string;
}): Promise<GrantRow> {
  if (!(input.access.isCoo || input.access.isLeadership))
    throw new AuthorizationError("Only the COO (or CEO) records access grants.");
  if (!PLATFORMS.some((p) => p.key === input.platform))
    throw new ValidationError("Unknown platform.");
  if (!input.role.trim()) throw new ValidationError("Enter the role granted on the platform.");
  if (!isIsoDate(input.grantedOn)) throw new ValidationError("Enter the date access was granted.");
  const person = await selectOne<PersonRow>("ops_people", { filters: [eq("id", input.personId)] });
  if (!person) throw new NotFoundError("Employee record not found.");
  const roles = await getOpsRoles();
  const privileged = isPrivilegedRole(input.platform, input.role);
  const approverIsLeader = [roles.ceo, roles.coo].includes(input.approverProfileId);
  if (privileged && !approverIsLeader)
    throw new ValidationError(
      `"${input.role}" on ${platformLabel(input.platform)} is privileged: the approver must be the CEO or COO, with a written reason. A job title is never enough.`,
    );
  if (privileged && input.approvalNote.trim().length < 10)
    throw new ValidationError("Privileged access needs the approver's written reason.");
  const [row] = await agentDb().insert<GrantRow>("ops_access_grants", {
    person_id: person.id,
    platform: input.platform,
    role: input.role.trim().slice(0, 120),
    privileged,
    status: "active",
    granted_on: input.grantedOn,
    approver_profile_id: input.approverProfileId,
    approval_note: input.approvalNote.slice(0, 1000),
    instance_id: input.instanceId ?? null,
    step_id: input.stepId ?? null,
    notes: "",
    created_by: input.access.userId,
  });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_access_grant",
    targetType: AUDIT_TARGET,
    targetId: row!.id,
    summary: `Recorded ${privileged ? "privileged " : ""}access on ${platformLabel(input.platform)}.`,
  });
  return row!;
}

export async function revokeGrant(input: {
  grantId: string;
  revokedOn: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<GrantRow> {
  if (!(input.access.isCoo || input.access.isLeadership))
    throw new AuthorizationError("Only the COO (or CEO) records access removal.");
  if (!isIsoDate(input.revokedOn)) throw new ValidationError("Enter the removal date.");
  const g = await selectOne<GrantRow>("ops_access_grants", { filters: [eq("id", input.grantId)] });
  if (!g) throw new NotFoundError("Grant not found.");
  if (g.status === "revoked") throw new ValidationError("Already recorded as removed.");
  const [row] = await agentDb().update<GrantRow>("ops_access_grants", [eq("id", g.id)], {
    status: "revoked",
    revoked_on: input.revokedOn,
    revoked_by: input.access.userId,
  });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_access_revoked",
    targetType: AUDIT_TARGET,
    targetId: g.id,
    summary: `Recorded access removal on ${platformLabel(g.platform)}.`,
  });
  return row!;
}

/** The 7-day audit: someone confirms in the platform's admin console that access is gone. */
export async function verifyRevocation(input: {
  grantId: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<GrantRow> {
  if (!(input.access.isCoo || input.access.isLeadership))
    throw new AuthorizationError("Only the COO (or CEO) confirms access removal.");
  const g = await selectOne<GrantRow>("ops_access_grants", { filters: [eq("id", input.grantId)] });
  if (!g || g.status !== "revoked") throw new ValidationError("Record the removal first.");
  const [row] = await agentDb().update<GrantRow>("ops_access_grants", [eq("id", g.id)], {
    revocation_verified_at: new Date().toISOString(),
    revocation_verified_by: input.access.userId,
  });
  return row!;
}

// ---------------------------------------------------------------------------
// Communication templates (versioned, drafts only)
// ---------------------------------------------------------------------------
export async function saveCommTemplate(input: {
  key: string;
  name: string;
  channel: "email" | "slack";
  subject: string;
  body: string;
  changeSummary: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<CommTemplateRow> {
  requireOps(input.access, "configure");
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) throw new ValidationError("Invalid template key.");
  if (!input.body.trim()) throw new ValidationError("Write the template text.");
  const versions = await agentDb().select<CommTemplateRow>("ops_comm_templates", {
    filters: [eq("key", input.key)],
    order: { col: "version", ascending: false },
  });
  for (const v of versions.filter((x) => x.status === "active"))
    await agentDb().update("ops_comm_templates", [eq("id", v.id)], { status: "superseded" });
  const [row] = await agentDb().insert<CommTemplateRow>("ops_comm_templates", {
    key: input.key,
    version: (versions[0]?.version ?? 0) + 1,
    status: "active",
    name: input.name.slice(0, 120),
    channel: input.channel,
    subject: input.subject.slice(0, 300),
    body: input.body.slice(0, 10_000),
    change_summary: input.changeSummary.slice(0, 300),
    created_by: input.access.userId,
  });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_comm_template",
    targetType: AUDIT_TARGET,
    summary: `Saved communication template "${input.name}" v${row!.version}. Existing case drafts are unchanged.`,
  });
  return row!;
}

/** Rollback copies an earlier version forward as a new version; history is never rewritten. */
export async function rollbackCommTemplate(input: {
  key: string;
  version: number;
  access: OpsAccess;
  actorLabel: string;
}) {
  const source = await selectOne<CommTemplateRow>("ops_comm_templates", {
    filters: [eq("key", input.key), eq("version", input.version)],
  });
  if (!source) throw new NotFoundError("Template version not found.");
  return saveCommTemplate({
    key: source.key,
    name: source.name,
    channel: source.channel,
    subject: source.subject,
    body: source.body,
    changeSummary: `Rolled back to v${source.version}`,
    access: input.access,
    actorLabel: input.actorLabel,
  });
}

// ---------------------------------------------------------------------------
// Recurring compliance
// ---------------------------------------------------------------------------
export async function saveCalendarItem(input: {
  key: string;
  ownerProfileId: string | null;
  ownerRole: string;
  verifiedDates: string[];
  active: boolean;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  for (const d of input.verifiedDates)
    if (!/^\d{2}-\d{2}$/.test(d)) throw new ValidationError("Dates are MM-DD (for example 02-01).");
  const [row] = await agentDb().update("ops_compliance_calendar", [eq("key", input.key)], {
    owner_profile_id: input.ownerProfileId,
    owner_role: input.ownerRole.slice(0, 40),
    verified_dates: input.verifiedDates.slice(0, 12),
    active: input.active,
  });
  if (!row) throw new NotFoundError("Calendar item not found.");
  return row;
}

export async function completeOccurrence(input: {
  occurrenceId: string;
  evidence: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "viewAll");
  if (input.evidence.trim().length < 3) throw new ValidationError("Add completion evidence.");
  const [row] = await agentDb().update(
    "ops_compliance_occurrences",
    [eq("id", input.occurrenceId), eq("status", "open")],
    {
      status: "completed",
      completed_by: input.access.userId,
      completed_at: new Date().toISOString(),
      evidence: input.evidence.slice(0, 1000),
    },
  );
  if (!row) throw new ValidationError("This occurrence is not open.");
  return row;
}

// ---------------------------------------------------------------------------
// Source document (Knowledge Hub ingest with version metadata)
// ---------------------------------------------------------------------------
export async function listSources(): Promise<SourceRow[]> {
  return agentDb().select<SourceRow>("ops_lifecycle_sources", {
    order: { col: "created_at", ascending: false },
  });
}

/**
 * Import (or replace) the checklist document. The file goes to the Knowledge Hub for Sam
 * (replacing the previous version there, which is archived, not deleted). The document is parsed
 * and reconciled with the current mapping; when wording changed, new draft template versions are
 * prepared for review. Running cases keep their pinned versions.
 */
export async function importSourceDocument(input: {
  buffer: Buffer;
  filename: string;
  versionLabel: string;
  note: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<{
  source: SourceRow;
  reconciliation: Reconciliation;
  draftsCreated: LifecyclePhase[];
}> {
  requireOps(input.access, "configure");
  if (!/\.docx$/i.test(input.filename))
    throw new ValidationError("Upload the checklist as a .docx file.");
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(input.versionLabel))
    throw new ValidationError(
      "Version label: letters, numbers, dots, or dashes (for example 2026-10-28).",
    );
  const parsed = await parseChecklistDocx(input.buffer);
  if (!parsed.items.length)
    throw new ValidationError("No checklist items (☐) were found in this document.");
  const hash = createHash("sha256").update(input.buffer).digest("hex");
  const sources = await listSources();
  if (sources.some((s) => s.content_hash === hash))
    throw new ValidationError("This exact document was already imported.");
  if (sources.some((s) => s.version_label === input.versionLabel))
    throw new ValidationError("That version label is already used.");
  const current = sources.find((s) => s.status === "current") ?? null;

  // Reconcile against the mapping currently used by the templates (latest versions).
  const base = await currentCatalog();
  const { catalog, reconciliation } = current
    ? catalogForNewVersion(base, parsed, input.versionLabel)
    : { catalog: { ...base }, reconciliation: reconcile(parsed, base) };

  const { getResolvedAgent } = await import("@/lib/agents/registry");
  const sam = await getResolvedAgent("sam");
  let knowledgeId: string | null = null;
  if (sam) {
    const { uploadKnowledgeDocument } = await import("@/lib/agents/knowledge");
    const doc = await uploadKnowledgeDocument({
      agentIds: [sam.row.id],
      filename: input.filename,
      buffer: input.buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      title: `${parsed.title || CHECKLIST_TITLE} (version ${input.versionLabel})`,
      description: `Leadership staff lifecycle checklist, document version ${input.versionLabel}${parsed.dateLine ? ` (${parsed.dateLine.split("·")[0]!.trim()})` : ""}. [CA]/[Fed] items are legal requirements per the document; timing is unverified until checked against official sources in the verification register.`,
      category: "hr-policies",
      sensitivity: "internal",
      uploadedBy: input.access.userId,
      replacesDocumentId: current?.knowledge_document_id ?? null,
    });
    knowledgeId = doc.id;
  }
  const changes =
    reconciliation.changed.length + reconciliation.added.length + reconciliation.removed.length;
  const [source] = await agentDb().insert<SourceRow>("ops_lifecycle_sources", {
    document_key: CHECKLIST_KEY,
    version_label: input.versionLabel,
    title: parsed.title || CHECKLIST_TITLE,
    document_date: parsed.dateLine.split("·")[0]?.trim() || null,
    filename: input.filename.slice(0, 200),
    content_hash: hash,
    knowledge_document_id: knowledgeId,
    status: "current",
    supersedes_id: current?.id ?? null,
    item_count: parsed.items.length,
    reconciliation: {
      summary: `${reconciliation.matched.length} unchanged, ${reconciliation.changed.length} changed, ${reconciliation.added.length} added, ${reconciliation.removed.length} removed.`,
      changed: reconciliation.changed,
      added: reconciliation.added,
      removed: reconciliation.removed,
      recurringChanged: reconciliation.recurringChanged,
      flagsChanged: reconciliation.flagsChanged,
      structureNotes: reconciliation.structureNotes,
    },
    note: input.note.slice(0, 1000),
    imported_by: input.access.userId,
  });
  if (current)
    await agentDb().update("ops_lifecycle_sources", [eq("id", current.id)], {
      status: "superseded",
    });

  // New draft template versions only when this document differs from the current mapping.
  const draftsCreated: LifecyclePhase[] = [];
  await ensureLifecycleSetup(input.access);
  if (current && changes) {
    for (const phase of LIFECYCLE_PHASES) {
      const { template, latest } = await lifecycleTemplate(phase);
      const next = definitionFromCatalog(phase, catalog, source!.id);
      const before = JSON.stringify(
        itemsFromDefinition(latest!.definition).map((i) => [i.id, i.text]),
      );
      const after = JSON.stringify(itemsFromDefinition(next).map((i) => [i.id, i.text]));
      if (before === after) continue;
      await saveDraft({
        templateId: template.id,
        definition: next,
        changeSummary: `Document version ${input.versionLabel}: ${reconciliation.changed.length} changed, ${reconciliation.added.length} added, ${reconciliation.removed.length} removed — review before publishing`,
        access: input.access,
        actorLabel: input.actorLabel,
      });
      draftsCreated.push(phase);
    }
    await ensureVerificationRows(catalog);
  }
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.lifecycle_source_imported",
    targetType: AUDIT_TARGET,
    targetId: source!.id,
    summary: `Imported checklist document version ${input.versionLabel} (${parsed.items.length} items; ${changes} change(s) from the current mapping).`,
  });
  return { source: source!, reconciliation, draftsCreated };
}

/** The catalog as the latest template versions currently describe it (admin edits included). */
export async function currentCatalog(): Promise<ChecklistCatalog> {
  const items: LifecycleItem[] = [];
  for (const phase of LIFECYCLE_PHASES) {
    const t = await selectOne<TemplateRow>("ops_workflow_templates", {
      filters: [eq("key", LIFECYCLE_TEMPLATE_KEYS[phase])],
    });
    if (!t) {
      items.push(...CHECKLIST_CATALOG.items.filter((i) => i.phase === phase));
      continue;
    }
    const versions = await agentDb().select<VersionRow>("ops_workflow_versions", {
      filters: [eq("template_id", t.id)],
      order: { col: "version", ascending: false },
      limit: 1,
    });
    items.push(
      ...itemsFromDefinition(versions[0]!.definition).filter((i) => i.origin === "document"),
    );
  }
  const version =
    (await listSources()).find((s) => s.status === "current")?.version_label ?? CHECKLIST_VERSION;
  return { ...CHECKLIST_CATALOG, documentVersion: version, items };
}
