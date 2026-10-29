/**
 * HTTP-facing service for the HR lifecycle tab of Sam Operations: one state loader scoped to
 * the viewer and one validated command dispatcher. Every command re-checks authorization in the
 * lib function it calls.
 */

import "server-only";

import { z } from "zod";
import type { AiContext } from "@/lib/agents/http";
import { agentDb } from "@/lib/agents/store";
import { ASSIGNEE_ROLES } from "@/lib/ops/definition";
import { decisionValue, getOpsAccess, getOpsRoles, requireOps } from "@/lib/ops/org";
import { getReportStore } from "@/lib/research/report-store";
import { CHECKLIST_CATALOG } from "./catalog";
import { DEFAULT_COMMUNICATIONS } from "./communications";
import { suggestRolesFromTitle } from "./plan";
import { PLATFORMS } from "./platforms";
import { acknowledgeReminder, listReminders } from "./reminders";
import * as svc from "./service";
import { itemsFromDefinition } from "./templates";
import { LIFECYCLE_PHASES, ROLE_KEYS, SEPARATION_TYPES, type LifecyclePhase } from "./types";

const label = (ctx: AiContext) => ctx.user.profile.full_name || ctx.user.email;

/** Everything the lifecycle tab shows, trimmed to what this viewer may see. */
export async function loadLifecycleState(ctx: AiContext) {
  const access = await getOpsAccess(ctx.requester);
  const reminders = await listReminders(access);
  const cases = await svc.listCases(access);
  const base = {
    access: {
      canViewAll: access.canViewAll,
      canConfigure: access.canConfigure,
      isLeadership: access.isLeadership,
      isCoo: access.isCoo,
    },
    cases,
    reminders,
  };
  if (!access.canConfigure && !access.canViewAll) return { ...base, limited: true as const };
  await svc.ensureLifecycleSetup(access);
  const roles = await getOpsRoles();
  const [
    templates,
    sources,
    settings,
    verifications,
    platforms,
    grants,
    calendar,
    occurrences,
    comms,
    profiles,
  ] = await Promise.all([
    Promise.all(
      LIFECYCLE_PHASES.map(async (phase) => {
        const t = await svc.lifecycleTemplate(phase);
        const latest = t.latest!;
        return {
          phase,
          templateId: t.template.id,
          name: t.template.name,
          status: t.template.status,
          published: t.published
            ? { id: t.published.id, version: t.published.version, at: t.published.published_at }
            : null,
          latest: {
            id: latest.id,
            version: latest.version,
            status: latest.status,
            changeSummary: latest.change_summary,
            documentVersion: latest.definition.lifecycle?.documentVersion ?? null,
          },
          versions: t.versions.map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            changeSummary: v.change_summary,
            createdAt: v.created_at,
          })),
          items: itemsFromDefinition(latest.definition),
        };
      }),
    ),
    svc.listSources(),
    svc.getLifecycleSettings(),
    agentDb().select<svc.VerificationRow>("ops_compliance_verifications", {
      order: { col: "item_id" },
    }),
    agentDb().select<svc.PlatformRow>("ops_software_platforms", { order: { col: "label" } }),
    access.canViewAll
      ? agentDb().select<svc.GrantRow>("ops_access_grants", {
          order: { col: "created_at", ascending: false },
          limit: 1000,
        })
      : Promise.resolve([] as svc.GrantRow[]),
    agentDb().select("ops_compliance_calendar", { order: { col: "key" } }),
    access.canViewAll
      ? agentDb().select("ops_compliance_occurrences", {
          order: { col: "due_date" },
          limit: 500,
        })
      : Promise.resolve([]),
    agentDb().select<svc.CommTemplateRow>("ops_comm_templates", {
      order: { col: "version", ascending: false },
    }),
    getReportStore().listProfiles(),
  ]);
  const people = access.canViewAll
    ? (
        await agentDb().select<{
          id: string;
          full_name: string;
          position: string | null;
          status: string;
          start_date: string | null;
          end_date: string | null;
          manager_profile_id: string | null;
          test_record: boolean;
          bamboohr_id: string | null;
        }>("ops_people", { order: { col: "full_name" }, limit: 2000 })
      ).map((p) => ({ ...p, suggestedRoles: suggestRolesFromTitle(p.position) }))
    : [];
  return {
    ...base,
    limited: false as const,
    catalog: {
      title: CHECKLIST_CATALOG.title,
      version: CHECKLIST_CATALOG.documentVersion,
      dateLine: CHECKLIST_CATALOG.dateLine,
      howToUse: CHECKLIST_CATALOG.howToUse,
      sources: CHECKLIST_CATALOG.sources,
      sourcesNote: CHECKLIST_CATALOG.sourcesNote,
      flags: CHECKLIST_CATALOG.flags,
      recurringIntro: CHECKLIST_CATALOG.recurringIntro,
    },
    management: access.canViewAll ? await svc.managementSummary(access) : null,
    templates,
    sources,
    settings,
    headcount: await decisionValue("company_headcount"),
    owners: {
      ceo: roles.ceo,
      coo: roles.coo,
      hrAdmins: roles.hrAdmins,
      financeOwner: roles.financeOwner,
      techOpsManager: roles.techOpsManager,
    },
    verifications,
    platforms,
    platformDefs: PLATFORMS,
    grants,
    calendar,
    occurrences,
    communications: comms,
    communicationDefaults: DEFAULT_COMMUNICATIONS.map((c) => ({ key: c.key, usedBy: c.usedBy })),
    profiles: profiles.map((p) => ({ id: p.id, full_name: p.full_name })),
    people,
  };
}

export async function loadCase(ctx: AiContext, id: string) {
  const access = await getOpsAccess(ctx.requester);
  return svc.caseDetail(id, access);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const id = z.string().uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));
const phase = z.enum(LIFECYCLE_PHASES as unknown as [LifecyclePhase, ...LifecyclePhase[]]);
const triState = z.boolean().nullable();

const caseInput = z.object({
  phase,
  personId: id,
  roles: z.array(z.enum(ROLE_KEYS)).max(4),
  rolesConfirmed: z.boolean(),
  exempt: triState,
  supervisor: triState,
  onGroupHealth: triState,
  separation: z.enum(SEPARATION_TYPES).nullable(),
  dates: z.object({
    offer_date: date,
    start_date: date,
    notice_date: date,
    last_day: date,
  }),
  hiringManagerProfileId: id.nullable(),
});

const condition = z.union([
  z.object({ fact: z.literal("role"), anyOf: z.array(z.enum(ROLE_KEYS)).min(1) }),
  z.object({ fact: z.literal("exempt"), equals: z.boolean() }),
  z.object({ fact: z.literal("supervisor"), equals: z.boolean() }),
  z.object({
    fact: z.literal("headcount"),
    gte: z.number().int().min(0).optional(),
    lte: z.number().int().min(0).optional(),
  }),
  z.object({ fact: z.literal("on_group_health"), equals: z.boolean() }),
  z.object({ fact: z.literal("separation"), anyOf: z.array(z.enum(SEPARATION_TYPES)).min(1) }),
]);
const anchor = z.enum(["offer_date", "start_date", "notice_date", "last_day"]);
const timing = z.union([
  z.object({ kind: z.literal("days"), anchor, offset: z.number().int().min(-365).max(365) }),
  z.object({ kind: z.literal("business_days"), anchor, offset: z.number().int().min(0).max(60) }),
  z.object({ kind: z.literal("months"), anchor, offset: z.number().int().min(0).max(36) }),
  z.object({ kind: z.literal("final_pay") }),
  z.object({ kind: z.literal("none") }),
]);

export const lifecycleCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("preview"), case: caseInput }),
  z.object({
    op: z.literal("start"),
    case: caseInput,
    mode: z.enum(["live", "test"]),
    reason: z.string().max(1000).default(""),
    idempotencyKey: z.string().max(120).optional(),
  }),
  z.object({
    op: z.literal("task_status"),
    stepId: id,
    transition: z.enum([
      "complete",
      "send_to_external_verification",
      "confirm_external_verification",
      "mark_not_applicable",
      "reopen",
    ]),
    note: z.string().max(2000).optional(),
    evidenceUrl: z.string().max(500).optional(),
    checklistDone: z.array(z.string().max(200)).max(40).optional(),
  }),
  z.object({ op: z.literal("task_note"), stepId: id, note: z.string().max(2000) }),
  z.object({
    op: z.literal("draft_edit"),
    stepId: id,
    subject: z.string().max(300),
    body: z.string().max(10_000),
  }),
  z.object({
    op: z.literal("item_edit"),
    phase,
    changeSummary: z.string().trim().min(2).max(300),
    edits: z
      .array(
        z.object({
          itemId: z.string().max(60),
          title: z.string().trim().min(1).max(160).optional(),
          text: z.string().trim().min(1).max(4000).optional(),
          owner: z.enum(ASSIGNEE_ROLES).optional(),
          timing: timing.optional(),
          timingText: z.string().max(300).optional(),
          roles: z.union([z.literal("general"), z.array(z.enum(ROLE_KEYS)).min(1)]).optional(),
          conditions: z.array(condition).max(6).optional(),
          dependsOn: z.array(z.string().max(60)).max(20).optional(),
          communication: z.string().max(40).nullable().optional(),
          flags: z.array(z.string().max(1000)).max(10).optional(),
          position: z.number().int().min(0).max(100).optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({
    op: z.literal("verify"),
    id,
    status: z.enum(["verified", "discrepancy"]),
    officialSourceUrl: z.string().max(500),
    officialSourceTitle: z.string().max(300),
    officialText: z.string().max(4000).optional(),
    discrepancy: z.string().max(4000).optional(),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    op: z.literal("platform_save"),
    key: z.string().max(60),
    seatsTotal: z.number().int().min(0).max(100_000).nullable(),
    seatsUsed: z.number().int().min(0).max(100_000).nullable(),
    seatCost: z.string().max(120).nullable(),
    seatCostSource: z.string().max(300).nullable(),
    ownerProfileId: id.nullable(),
    notes: z.string().max(1000).default(""),
  }),
  z.object({
    op: z.literal("grant_record"),
    personId: id,
    platform: z.string().max(60),
    role: z.string().max(120),
    grantedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    approverProfileId: id,
    approvalNote: z.string().max(1000).default(""),
    instanceId: id.nullable().optional(),
    stepId: id.nullable().optional(),
  }),
  z.object({
    op: z.literal("grant_revoke"),
    grantId: id,
    revokedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ op: z.literal("grant_verify_removed"), grantId: id }),
  z.object({
    op: z.literal("comm_save"),
    key: z.string().max(40),
    name: z.string().trim().min(2).max(120),
    channel: z.enum(["email", "slack"]),
    subject: z.string().max(300),
    body: z.string().max(10_000),
    changeSummary: z.string().trim().min(2).max(300),
  }),
  z.object({
    op: z.literal("comm_rollback"),
    key: z.string().max(40),
    version: z.number().int().min(1),
  }),
  z.object({
    op: z.literal("calendar_save"),
    key: z.string().max(60),
    ownerProfileId: id.nullable(),
    ownerRole: z.string().max(40),
    verifiedDates: z.array(z.string().max(5)).max(12),
    active: z.boolean(),
  }),
  z.object({
    op: z.literal("occurrence_complete"),
    occurrenceId: id,
    evidence: z.string().max(1000),
  }),
  z.object({
    op: z.literal("settings_save"),
    leadDays: z.number().int().min(0).max(30),
    externalEnabled: z.boolean(),
  }),
  z.object({ op: z.literal("reminder_ack"), id }),
]);

export async function runLifecycleCommand(ctx: AiContext, raw: unknown): Promise<unknown> {
  const cmd = lifecycleCommandSchema.parse(raw);
  const access = await getOpsAccess(ctx.requester);
  const actorLabel = label(ctx);
  const base = { access, actorLabel };
  switch (cmd.op) {
    case "preview":
      return svc.previewCase(cmd.case, access);
    case "start":
      return svc.startCase({
        case: cmd.case,
        mode: cmd.mode,
        reason: cmd.reason,
        idempotencyKey: cmd.idempotencyKey,
        ...base,
      });
    case "task_status":
      return svc.changeTaskStatus({ ...cmd, ...base });
    case "task_note":
      return svc.addTaskNote({ stepId: cmd.stepId, note: cmd.note, ...base });
    case "draft_edit":
      return svc.updateCaseDraft({ ...cmd, ...base });
    case "item_edit":
      return svc.saveItemEdits({
        phase: cmd.phase,
        edits: cmd.edits,
        changeSummary: cmd.changeSummary,
        ...base,
      });
    case "verify":
      return svc.verifyRequirement({ ...cmd, ...base });
    case "platform_save":
      return svc.savePlatform({ ...cmd, ...base });
    case "grant_record":
      return svc.recordGrant({ ...cmd, ...base });
    case "grant_revoke":
      return svc.revokeGrant({ ...cmd, ...base });
    case "grant_verify_removed":
      return svc.verifyRevocation({ grantId: cmd.grantId, ...base });
    case "comm_save":
      return svc.saveCommTemplate({ ...cmd, ...base });
    case "comm_rollback":
      return svc.rollbackCommTemplate({ ...cmd, ...base });
    case "calendar_save":
      return svc.saveCalendarItem({ ...cmd, ...base });
    case "occurrence_complete":
      return svc.completeOccurrence({ ...cmd, ...base });
    case "settings_save":
      return svc.saveLifecycleSettings({ ...cmd, ...base });
    case "reminder_ack": {
      const ok = await acknowledgeReminder(cmd.id, access);
      if (!ok) requireOps(access, "viewAll");
      return ok;
    }
  }
}

/** Source document upload (multipart). */
export async function importSource(
  ctx: AiContext,
  file: { name: string; buffer: Buffer },
  versionLabel: string,
  note: string,
) {
  const access = await getOpsAccess(ctx.requester);
  return svc.importSourceDocument({
    buffer: file.buffer,
    filename: file.name,
    versionLabel,
    note,
    access,
    actorLabel: label(ctx),
  });
}
