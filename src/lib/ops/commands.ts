/**
 * HTTP-facing service for Sam Operations Studio: one state loader (scoped to the viewer) and one
 * validated command dispatcher. Every command re-checks authorization in the lib function it
 * calls; nothing here trusts the browser's idea of who may do what.
 */

import "server-only";

import { z } from "zod";
import { decideApproval } from "@/lib/agents/approvals";
import type { AiContext } from "@/lib/agents/http";
import { agentDb, eq, inList, selectOne } from "@/lib/agents/store";
import { SAM_SLUG } from "@/lib/agents/defaults";
import { getResolvedAgent } from "@/lib/agents/registry";
import { isAppAccessRole } from "@/lib/auth/roles";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { getReportStore } from "@/lib/research/report-store";
import {
  cancelAction,
  completeManualAction,
  listActions,
  retryAction,
  simulateApproval,
  type ActionRow,
} from "./actions";
import {
  ACTION_LABELS,
  ACTION_TYPES,
  ROLE_LABELS,
  STEP_TYPES,
  validateDefinition,
} from "./definition";
import { listOpsDocuments, setDocumentStatus } from "./documents";
import {
  completeStep,
  createTemplate,
  diffDefinitions,
  getInstanceDetail,
  getTemplateDetail,
  inboxFor,
  listInstances,
  listTemplates,
  migrateInstance,
  overrideStep,
  reassignStep,
  requestPublish,
  rollbackToVersion,
  saveDraft,
  setInstanceStatus,
  setTemplateArchived,
  startWorkflow,
} from "./engine";
import {
  integrationStatuses,
  saveIntegrationSettings,
  testIntegration,
  getIntegrationSettings,
  type IntegrationKey,
} from "./integrations";
import {
  DECISION_DEFS,
  getOpsAccess,
  listDecisions,
  listEntities,
  requireOps,
  setDecision,
  updateEntity,
  type OpsAccess,
} from "./org";
import * as reg from "./registers";
import { ensureStarterWorkflows } from "./starters";

export async function opsAccessFor(ctx: AiContext): Promise<OpsAccess> {
  return getOpsAccess(ctx.requester);
}

const label = (ctx: AiContext) => ctx.user.profile.full_name || ctx.user.email;

const OPS_AUDIT_TARGETS = [
  "ops_workflow",
  "ops_instance",
  "ops_step",
  "ops_action",
  "ops_document",
  "ops_decision",
  "ops_entity",
  "ops_person",
  "ops_contract",
  "ops_contract_template",
  "ops_insurance",
  "ops_survey",
  "ops_vacancy",
  "ops_interview",
  "ops_autonomy",
  "ops_integration",
];

/** Everything the Studio shows, trimmed to what this viewer may see. */
export async function loadOpsState(ctx: AiContext) {
  const access = await opsAccessFor(ctx);
  const base = {
    access,
    stepTypes: STEP_TYPES,
    roleLabels: ROLE_LABELS,
    actionLabels: ACTION_LABELS,
    actionTypes: ACTION_TYPES,
    inbox: await inboxFor(access),
    myWorkflows: await listInstances(access),
  };
  if (!access.canViewAll && !access.canConfigure) return { ...base, limited: true as const };
  if (access.canConfigure) {
    await ensureStarterWorkflows();
    // Leadership-brief material for Sam's Knowledge Hub (once; never replaces admin edits).
    await import("./brief-knowledge")
      .then((m) => m.ensureBriefKnowledge(access.userId))
      .catch(() => 0);
  }
  const [decisions, entities, integrations, templates, actions, people, autonomy, profiles, audit] =
    await Promise.all([
      listDecisions(),
      listEntities(),
      integrationStatuses(),
      listTemplates(),
      listActions({ limit: 300 }),
      reg.listPeople(access),
      reg.listAutonomyRules(),
      getReportStore().listProfiles(),
      agentDb().select<{
        id: string;
        actor_label: string | null;
        action: string;
        target_type: string;
        target_id: string | null;
        summary: string;
        created_at: string;
      }>("ai_audit_log", {
        filters: [inList("target_type", OPS_AUDIT_TARGETS)],
        order: { col: "created_at", ascending: false },
        limit: 300,
      }),
    ]);
  const canSee = access.canViewAll;
  const [contracts, contractTemplates, insurance, surveys, recruiting, timecards, documents] =
    canSee
      ? await Promise.all([
          reg.listContracts(access),
          reg.listContractTemplates(),
          reg.listInsurance(access),
          reg.listSurveys(access),
          reg.listVacancies(access),
          reg.listTimecardChecks(access),
          listOpsDocuments({}, access),
        ])
      : [[], [], [], [], { vacancies: [], interviews: [] }, [], []];
  const driveFolders = ((await getIntegrationSettings("google_drive")).config.folders ??
    {}) as Record<string, string>;
  const sam = await getResolvedAgent(SAM_SLUG);
  const samKnowledge = sam
    ? await agentDb().select<{ document_id: string }>("ai_knowledge_document_agents", {
        filters: [eq("agent_id", sam.row.id)],
      })
    : [];
  const samPolicies = sam
    ? await agentDb().select<{
        principal_type: string;
        principal_value: string;
        access_level: string;
      }>("ai_agent_access_policies", { filters: [eq("agent_id", sam.row.id)] })
    : [];
  return {
    ...base,
    limited: false as const,
    decisions,
    entities,
    integrations,
    templates: templates.map((t) => ({
      ...t,
      issues: t.latestVersion ? validateDefinition(t.latestVersion.definition) : [],
    })),
    actions,
    people,
    autonomy,
    profiles: profiles
      .filter((p) => isAppAccessRole(p.role))
      .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    audit,
    contracts,
    contractTemplates,
    insurance,
    surveys,
    vacancies: recruiting.vacancies,
    interviews: recruiting.interviews,
    timecards,
    documents: documents.map((d) => ({ ...d, extracted_text: null })),
    driveFolders,
    decisionDefs: DECISION_DEFS,
    sam: sam
      ? {
          title: sam.row.title,
          description: sam.row.description,
          version: sam.versionNumber,
          toolsEnabled: sam.config.tools.enabled,
          knowledgeDocuments: samKnowledge.length,
          accessPolicies: samPolicies.map((p) => ({
            type: p.principal_type,
            value: p.principal_value,
            level: p.access_level,
          })),
          keywords: sam.config.delegation.keywords,
        }
      : null,
  };
}

export async function loadInstance(ctx: AiContext, id: string) {
  const access = await opsAccessFor(ctx);
  const detail = await getInstanceDetail(id);
  if (!access.canViewAll) {
    const mine = detail.steps.some((s) => s.assignee_profile_id === access.userId);
    if (!mine)
      throw new AuthorizationError("You can only see workflows with steps assigned to you.");
    return { ...detail, actions: [], documents: [] };
  }
  return { ...detail, documents: await listOpsDocuments({ instanceId: id }, access) };
}

export async function loadTemplate(ctx: AiContext, id: string) {
  const access = await opsAccessFor(ctx);
  requireOps(access, "configure");
  const detail = await getTemplateDetail(id);
  const [latest, published] = [
    detail.versions[0],
    detail.versions.find((v) => v.id === detail.template.published_version_id),
  ];
  return {
    ...detail,
    diffFromPublished:
      latest && published && latest.id !== published.id
        ? diffDefinitions(published.definition, latest.definition)
        : [],
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const id = z.string().uuid();
const rec = z.record(z.string(), z.unknown());
const strRec = z.record(z.string(), z.string().max(20_000));

export const opsCommandSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("decision"),
    key: z.string().max(60),
    status: z.enum(["open", "confirmed", "not_applicable"]),
    value: z.unknown().optional(),
    note: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    op: z.literal("entity"),
    id,
    name: z.string().trim().min(2).max(120).optional(),
    confirmed: z.boolean().optional(),
    active: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("integration_test"),
    key: z.enum([
      "bamboohr",
      "google_drive",
      "gmail",
      "google_calendar",
      "docusign",
      "betterteam",
      "jobtread",
      "slack",
    ]),
  }),
  z.object({
    op: z.literal("drive_folders"),
    folders: z.record(z.string().max(80), z.string().max(120)),
  }),
  z.object({
    op: z.literal("template_create"),
    key: z.string().regex(/^[a-z][a-z0-9-]{1,50}$/),
    name: z.string().trim().min(2).max(120),
    category: z.string().max(60),
    description: z.string().max(1000).default(""),
    definition: z.unknown(),
  }),
  z.object({
    op: z.literal("template_save"),
    templateId: id,
    definition: z.unknown(),
    changeSummary: z.string().trim().min(2).max(300),
    name: z.string().max(120).optional(),
    description: z.string().max(1000).optional(),
  }),
  z.object({ op: z.literal("template_publish"), templateId: id, versionId: id }),
  z.object({ op: z.literal("template_rollback"), templateId: id, versionId: id }),
  z.object({ op: z.literal("template_archive"), templateId: id, archived: z.boolean() }),
  z.object({
    op: z.literal("workflow_start"),
    templateId: id,
    entityId: id.nullable(),
    personId: id.nullable(),
    subjectLabel: z.string().trim().min(2).max(160),
    inputs: strRec,
    mode: z.enum(["live", "test"]),
    reason: z.string().max(1000).default(""),
    idempotencyKey: z.string().max(120).optional(),
  }),
  z.object({
    op: z.literal("workflow_status"),
    instanceId: id,
    status: z.enum(["paused", "active", "cancelled"]),
    reason: z.string().max(500).default(""),
  }),
  z.object({ op: z.literal("workflow_migrate"), instanceId: id, apply: z.boolean() }),
  z.object({
    op: z.literal("step_complete"),
    stepId: id,
    data: strRec.optional(),
    checklistDone: z.array(z.string().max(200)).max(40).optional(),
    note: z.string().max(2000).optional(),
    evidenceUrl: z.string().max(500).optional(),
  }),
  z.object({
    op: z.literal("step_override"),
    stepId: id,
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({ op: z.literal("step_reassign"), stepId: id, profileId: id }),
  z.object({
    op: z.literal("action_decide"),
    actionId: id,
    decision: z.enum(["approved", "rejected"]),
    note: z.string().max(1000).nullable().default(null),
  }),
  z.object({ op: z.literal("action_simulate"), actionId: id }),
  z.object({ op: z.literal("action_retry"), actionId: id }),
  z.object({
    op: z.literal("action_manual_done"),
    actionId: id,
    note: z.string().trim().min(3).max(1000),
    evidenceUrl: z.string().max(500).optional(),
  }),
  z.object({
    op: z.literal("action_cancel"),
    actionId: id,
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    op: z.literal("document_status"),
    documentId: id,
    status: z.enum(["verified", "rejected", "archived"]),
  }),
  z.object({ op: z.literal("person_save"), id: id.optional(), values: rec }),
  z.object({ op: z.literal("contract_save"), id: id.optional(), values: rec }),
  z.object({ op: z.literal("contract_review"), contractId: id }),
  z.object({
    op: z.literal("contract_sign"),
    contractId: id,
    signers: z.array(z.object({ name: z.string().max(120), email: z.string().max(200) })).max(10),
    mode: z.enum(["live", "test"]),
  }),
  z.object({
    op: z.literal("contract_generate"),
    templateId: id,
    values: strRec,
    counterparty: z.string().trim().min(2).max(200),
    title: z.string().trim().min(2).max(200),
    entityId: id.nullable(),
  }),
  z.object({ op: z.literal("contract_template_save"), id: id.optional(), values: rec }),
  z.object({ op: z.literal("contract_template_approve"), templateId: id }),
  z.object({ op: z.literal("insurance_save"), id: id.optional(), values: rec }),
  z.object({ op: z.literal("survey_save"), id: id.optional(), values: rec }),
  z.object({ op: z.literal("survey_request"), surveyId: id }),
  z.object({
    op: z.literal("survey_results"),
    surveyId: id,
    invited: z.number().int().min(0).max(10_000),
    responses: z
      .array(
        z.object({
          group: z.string().max(80),
          answers: z.record(z.string().max(40), z.union([z.number(), z.string().max(400)])),
        }),
      )
      .max(5000),
  }),
  z.object({ op: z.literal("vacancy_save"), id: id.optional(), values: rec }),
  z.object({
    op: z.literal("vacancy_publish"),
    vacancyId: id,
    mode: z.enum(["live", "test"]).default("live"),
  }),
  z.object({ op: z.literal("vacancy_posted"), vacancyId: id, postingUrl: z.string().max(500) }),
  z.object({
    op: z.literal("interview_create"),
    vacancyId: id.nullable(),
    candidateName: z.string().max(160),
    candidateEmail: z.string().max(200).default(""),
    interviewerIds: z.array(id).max(6),
  }),
  z.object({
    op: z.literal("interview_slots"),
    interviewId: id,
    durationMinutes: z.number().int().min(15).max(240).default(45),
  }),
  z.object({
    op: z.literal("interview_book"),
    interviewId: id,
    start: z.string().max(40),
    end: z.string().max(40),
    calendarId: z.string().max(200).default("primary"),
    mode: z.enum(["live", "test"]),
  }),
  z.object({
    op: z.literal("interview_record"),
    interviewId: id,
    start: z.string().max(40),
    end: z.string().max(40),
  }),
  z.object({ op: z.literal("timecard_check") }),
  z.object({
    op: z.literal("autonomy_enable"),
    actionType: z.string().max(40),
    workflowKey: z.string().max(60).nullable(),
    entityId: id.nullable(),
    note: z.string().max(500),
  }),
  z.object({ op: z.literal("autonomy_revoke"), id }),
]);
export type OpsCommand = z.infer<typeof opsCommandSchema>;

export async function runOpsCommand(ctx: AiContext, raw: unknown): Promise<unknown> {
  const cmd = opsCommandSchema.parse(raw);
  const access = await opsAccessFor(ctx);
  const actorLabel = label(ctx);
  const base = { access, actorLabel };
  switch (cmd.op) {
    case "decision":
      return setDecision({
        key: cmd.key,
        status: cmd.status,
        value: cmd.value,
        note: cmd.note ?? null,
        ...base,
      });
    case "entity":
      return updateEntity(
        cmd.id,
        {
          ...(cmd.name ? { name: cmd.name } : {}),
          ...(cmd.confirmed !== undefined ? { confirmed: cmd.confirmed } : {}),
          ...(cmd.active !== undefined ? { active: cmd.active } : {}),
        },
        access,
        actorLabel,
      );
    case "integration_test":
      requireOps(access, "configure");
      return testIntegration(cmd.key as IntegrationKey, access.userId);
    case "drive_folders":
      requireOps(access, "configure");
      for (const v of Object.values(cmd.folders))
        if (v && !/^[A-Za-z0-9_-]{10,}$/.test(v))
          throw new ValidationError(
            "Drive folder ids look like 1AbC…; paste the id from the folder's link.",
          );
      return saveIntegrationSettings(
        "google_drive",
        {
          config: {
            ...(await getIntegrationSettings("google_drive")).config,
            folders: cmd.folders,
          },
        },
        access.userId,
      );
    case "template_create":
      return createTemplate({ ...cmd, ...base });
    case "template_save":
      return saveDraft({
        templateId: cmd.templateId,
        definition: cmd.definition,
        changeSummary: cmd.changeSummary,
        meta: {
          ...(cmd.name ? { name: cmd.name } : {}),
          ...(cmd.description !== undefined ? { description: cmd.description } : {}),
        },
        ...base,
      });
    case "template_publish":
      return requestPublish({ templateId: cmd.templateId, versionId: cmd.versionId, ...base });
    case "template_rollback":
      return rollbackToVersion({ templateId: cmd.templateId, versionId: cmd.versionId, ...base });
    case "template_archive":
      return setTemplateArchived(cmd.templateId, cmd.archived, access, actorLabel);
    case "workflow_start":
      return startWorkflow({ ...cmd, ...base });
    case "workflow_status":
      return setInstanceStatus({
        instanceId: cmd.instanceId,
        status: cmd.status,
        reason: cmd.reason,
        ...base,
      });
    case "workflow_migrate":
      return migrateInstance({ instanceId: cmd.instanceId, apply: cmd.apply, ...base });
    case "step_complete":
      return completeStep({
        stepId: cmd.stepId,
        data: cmd.data,
        checklistDone: cmd.checklistDone,
        note: cmd.note,
        evidenceUrl: cmd.evidenceUrl,
        ...base,
      });
    case "step_override":
      return overrideStep({ stepId: cmd.stepId, reason: cmd.reason, ...base });
    case "step_reassign":
      return reassignStep({ stepId: cmd.stepId, profileId: cmd.profileId, ...base });
    case "action_decide": {
      const action = await selectOne<ActionRow>("ops_actions", {
        filters: [eq("id", cmd.actionId)],
      });
      if (!action?.approval_request_id)
        throw new ValidationError("This action has no pending approval.");
      if (!access.isLeadership)
        throw new AuthorizationError("Only the confirmed CEO or COO can approve Sam's actions.");
      return decideApproval({
        id: action.approval_request_id,
        decision: cmd.decision,
        userId: ctx.user.id,
        note: cmd.note,
      });
    }
    case "action_simulate":
      return simulateApproval(cmd.actionId, access, actorLabel);
    case "action_retry":
      return retryAction(cmd.actionId, access);
    case "action_manual_done":
      return completeManualAction(cmd.actionId, access, actorLabel, cmd.note, cmd.evidenceUrl);
    case "action_cancel":
      return cancelAction(cmd.actionId, access, actorLabel, cmd.reason);
    case "document_status":
      return setDocumentStatus(cmd.documentId, cmd.status, access, actorLabel);
    case "person_save":
      return reg.savePerson({ id: cmd.id, values: cmd.values, ...base });
    case "contract_save":
      return reg.saveContract({ id: cmd.id, values: cmd.values, ...base });
    case "contract_review":
      return reg.reviewContract(cmd.contractId, access, actorLabel);
    case "contract_sign":
      return reg.requestContractSignature({
        contractId: cmd.contractId,
        signers: cmd.signers,
        mode: cmd.mode,
        ...base,
      });
    case "contract_generate":
      return reg.generateContract({ ...cmd, ...base });
    case "contract_template_save":
      return reg.saveContractTemplate({ id: cmd.id, values: cmd.values, ...base });
    case "contract_template_approve":
      return reg.requestTemplateApproval(cmd.templateId, access, actorLabel);
    case "insurance_save":
      return reg.saveInsurance({ id: cmd.id, values: cmd.values, ...base });
    case "survey_save":
      return reg.saveSurvey({ id: cmd.id, values: cmd.values, ...base });
    case "survey_request":
      return reg.requestSurveyApproval(cmd.surveyId, access, actorLabel);
    case "survey_results":
      return reg.recordSurveyResults({
        surveyId: cmd.surveyId,
        invited: cmd.invited,
        responses: cmd.responses,
        ...base,
      });
    case "vacancy_save":
      return reg.saveVacancy({ id: cmd.id, values: cmd.values, ...base });
    case "vacancy_publish":
      return reg.requestVacancyPublication(cmd.vacancyId, access, actorLabel, cmd.mode);
    case "vacancy_posted":
      return reg.recordVacancyPosting(cmd.vacancyId, cmd.postingUrl, access, actorLabel);
    case "interview_create":
      return reg.createInterview({ ...cmd, ...base });
    case "interview_slots":
      return reg.proposeInterviewSlots(cmd.interviewId, access, cmd.durationMinutes);
    case "interview_book":
      return reg.requestInterviewBooking({ ...cmd, ...base });
    case "interview_record":
      return reg.recordInterviewTime(cmd.interviewId, cmd.start, cmd.end, access, actorLabel);
    case "timecard_check":
      requireOps(access, "configure");
      return reg.runTimecardCheck();
    case "autonomy_enable":
      return reg.enableAutonomy({ ...cmd, ...base });
    case "autonomy_revoke":
      return reg.revokeAutonomy(cmd.id, access, actorLabel);
  }
}
