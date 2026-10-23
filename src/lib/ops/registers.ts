/**
 * Sam Operations registers: people, contracts & templates, insurance, surveys, vacancies,
 * interviews, timecard checks, and autonomy rules. Every external effect is an approval-bound
 * action (actions.ts); the register rows record state and evidence.
 */

import "server-only";

import { recordAudit } from "@/lib/agents/audit";
import { loadAuthEmailsByUserIds } from "@/lib/auth/load-profile-display";
import { agentDb, eq, inList, selectOne } from "@/lib/agents/store";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { executeAction, proposeAction, type ActionRow } from "./actions";
import { ACTION_TYPES } from "./definition";
import { getOpsDocument, uploadOpsDocument } from "./documents";
import {
  calendarFreeBusy,
  docusignStatus,
  googleScopes,
  jobtreadTimeEntryCount,
} from "./integrations";
import { decisionValue, getOpsRoles, requireOps, type OpsAccess } from "./org";
import {
  aggregateSurveyResponses,
  dueReminderThresholds,
  fillContractTemplate,
  mergeFieldsIn,
  proposeFreeSlots,
  reviewContractText,
  type SurveyResponse,
} from "./rules";

const actor = (a: OpsAccess, label: string) => ({ userId: a.userId, label });
const today = () => new Date().toISOString().slice(0, 10);
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const dateOrNull = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const reminderList = (v: unknown) =>
  Array.isArray(v)
    ? v
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365)
        .slice(0, 8)
    : [90, 60, 30, 7];

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export type PersonRow = {
  id: string;
  entity_id: string | null;
  full_name: string;
  work_email: string | null;
  personal_email: string | null;
  position: string | null;
  department: string | null;
  status: "candidate" | "pre_hire" | "active" | "offboarding" | "former";
  start_date: string | null;
  end_date: string | null;
  bamboohr_id: string | null;
  profile_id: string | null;
  manager_profile_id: string | null;
  test_record: boolean;
  created_at: string;
  updated_at: string;
};

export async function listPeople(access: OpsAccess): Promise<PersonRow[]> {
  if (!access.canViewAll) {
    return agentDb().select<PersonRow>("ops_people", {
      filters: [eq("profile_id", access.userId ?? "-")],
    });
  }
  return agentDb().select<PersonRow>("ops_people", { order: { col: "full_name" }, limit: 2000 });
}

export async function savePerson(input: {
  id?: string;
  values: Record<string, unknown>;
  access: OpsAccess;
  actorLabel: string;
}): Promise<PersonRow> {
  requireOps(input.access, "configure");
  const v = input.values;
  const statuses = ["candidate", "pre_hire", "active", "offboarding", "former"];
  const patch = {
    entity_id: clip(v.entity_id, 40) || null,
    full_name: clip(v.full_name, 160),
    work_email: clip(v.work_email, 200) || null,
    personal_email: clip(v.personal_email, 200) || null,
    position: clip(v.position, 120) || null,
    department: clip(v.department, 120) || null,
    status: statuses.includes(String(v.status)) ? String(v.status) : "pre_hire",
    start_date: dateOrNull(v.start_date),
    end_date: dateOrNull(v.end_date),
    bamboohr_id: clip(v.bamboohr_id, 40) || null,
    profile_id: clip(v.profile_id, 40) || null,
    manager_profile_id: clip(v.manager_profile_id, 40) || null,
    test_record: Boolean(v.test_record),
  };
  if (!patch.full_name) throw new ValidationError("Enter the person's name.");
  const [row] = input.id
    ? await agentDb().update<PersonRow>("ops_people", [eq("id", input.id)], patch)
    : await agentDb().insert<PersonRow>("ops_people", {
        ...patch,
        created_by: input.access.userId,
      });
  if (!row) throw new NotFoundError("Person not found.");
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: input.id ? "ops.person_updated" : "ops.person_created",
    targetType: "ops_person",
    targetId: row.id,
    summary: `${input.id ? "Updated" : "Added"} ${patch.test_record ? "test record" : "person"} ${patch.full_name}.`,
  });
  return row;
}

// ---------------------------------------------------------------------------
// Contract templates & contracts
// ---------------------------------------------------------------------------
export type ContractTemplateRow = {
  id: string;
  entity_id: string | null;
  contract_type: string;
  name: string;
  version: number;
  status: "draft" | "approved" | "inactive";
  document_id: string | null;
  drive_file_id: string | null;
  merge_fields: string[];
  body: string | null;
  review_owner_profile_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ContractRow = {
  id: string;
  entity_id: string | null;
  contract_type: string;
  title: string;
  counterparty: string;
  status:
    | "draft"
    | "in_review"
    | "approved"
    | "out_for_signature"
    | "signed"
    | "active"
    | "expired"
    | "terminated"
    | "archived";
  template_id: string | null;
  document_id: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_date: string | null;
  notice_days: number | null;
  dates_verified: boolean;
  owner_profile_id: string | null;
  signature_status: string | null;
  docusign_envelope_id: string | null;
  review: Record<string, unknown> | null;
  reminder_days: number[];
  notes: string;
  created_at: string;
  updated_at: string;
};

export async function listContractTemplates(): Promise<ContractTemplateRow[]> {
  return agentDb().select<ContractTemplateRow>("ops_contract_templates", {
    order: { col: "name" },
  });
}

export async function saveContractTemplate(input: {
  id?: string;
  values: Record<string, unknown>;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const body = clip(input.values.body, 100_000);
  const patch = {
    entity_id: clip(input.values.entity_id, 40) || null,
    contract_type: clip(input.values.contract_type, 80) || "General",
    name: clip(input.values.name, 160),
    body,
    merge_fields: mergeFieldsIn(body),
    review_owner_profile_id: clip(input.values.review_owner_profile_id, 40) || null,
  };
  if (!patch.name || !body) throw new ValidationError("Name the template and paste its text.");
  let row: ContractTemplateRow | undefined;
  if (input.id) {
    const prev = await selectOne<ContractTemplateRow>("ops_contract_templates", {
      filters: [eq("id", input.id)],
    });
    if (!prev) throw new NotFoundError("Template not found.");
    // Editing an approved template creates a new draft version; the approved one stays usable.
    if (prev.status === "approved") {
      [row] = await agentDb().insert<ContractTemplateRow>("ops_contract_templates", {
        ...patch,
        version: prev.version + 1,
        status: "draft",
        created_by: input.access.userId,
      });
    } else {
      [row] = await agentDb().update<ContractTemplateRow>(
        "ops_contract_templates",
        [eq("id", input.id)],
        patch,
      );
    }
  } else {
    [row] = await agentDb().insert<ContractTemplateRow>("ops_contract_templates", {
      ...patch,
      status: "draft",
      version: 1,
      created_by: input.access.userId,
    });
  }
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.contract_template_saved",
    targetType: "ops_contract_template",
    targetId: row!.id,
    summary: `Saved contract template "${row!.name}" v${row!.version} (draft).`,
  });
  return row!;
}

/** Contract templates become usable only once leadership approves them. */
export async function requestTemplateApproval(
  templateId: string,
  access: OpsAccess,
  actorLabel: string,
) {
  requireOps(access, "configure");
  const t = await selectOne<ContractTemplateRow>("ops_contract_templates", {
    filters: [eq("id", templateId)],
  });
  if (!t) throw new NotFoundError("Template not found.");
  return proposeItemApproval({
    register: "contract_template",
    id: t.id,
    title: `Approve contract template "${t.name}" v${t.version}`,
    summary: `${t.contract_type} template with merge fields: ${t.merge_fields.join(", ") || "none"}.`,
    snapshot: { body: t.body, version: t.version },
    effect: "Contracts can be generated from this version.",
    access,
    actorLabel,
  });
}

export async function listContracts(access: OpsAccess): Promise<ContractRow[]> {
  requireOps(access, "viewAll");
  return agentDb().select<ContractRow>("ops_contracts", {
    order: { col: "expiration_date" },
    limit: 2000,
  });
}

export async function saveContract(input: {
  id?: string;
  values: Record<string, unknown>;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const v = input.values;
  const statuses = [
    "draft",
    "in_review",
    "approved",
    "out_for_signature",
    "signed",
    "active",
    "expired",
    "terminated",
    "archived",
  ];
  const patch: Partial<ContractRow> = {
    entity_id: clip(v.entity_id, 40) || null,
    contract_type: clip(v.contract_type, 80) || "General",
    title: clip(v.title, 200),
    counterparty: clip(v.counterparty, 200),
    status: (statuses.includes(String(v.status))
      ? String(v.status)
      : "draft") as ContractRow["status"],
    effective_date: dateOrNull(v.effective_date),
    expiration_date: dateOrNull(v.expiration_date),
    renewal_date: dateOrNull(v.renewal_date),
    notice_days:
      Number.isInteger(Number(v.notice_days)) && v.notice_days !== "" && v.notice_days !== null
        ? Number(v.notice_days)
        : null,
    dates_verified: Boolean(v.dates_verified),
    owner_profile_id: clip(v.owner_profile_id, 40) || null,
    reminder_days: reminderList(v.reminder_days),
    notes: clip(v.notes, 4000),
    document_id: clip(v.document_id, 40) || null,
  };
  if (!patch.title || !patch.counterparty)
    throw new ValidationError("Enter the contract title and counterparty.");
  const [row] = input.id
    ? await agentDb().update<ContractRow>("ops_contracts", [eq("id", input.id)], patch)
    : await agentDb().insert<ContractRow>("ops_contracts", {
        ...patch,
        created_by: input.access.userId,
      });
  if (!row) throw new NotFoundError("Contract not found.");
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.contract_saved",
    targetType: "ops_contract",
    targetId: row.id,
    summary: `Saved contract "${row.title}" (${row.counterparty}).`,
    details: { datesVerified: row.dates_verified },
  });
  return row;
}

/** Generate a contract from an APPROVED template; refuses if merge fields are missing. */
export async function generateContract(input: {
  templateId: string;
  values: Record<string, string>;
  counterparty: string;
  title: string;
  entityId: string | null;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const t = await selectOne<ContractTemplateRow>("ops_contract_templates", {
    filters: [eq("id", input.templateId)],
  });
  if (!t) throw new NotFoundError("Template not found.");
  if (t.status !== "approved")
    throw new ValidationError(
      "Only leadership-approved templates can be used to generate contracts.",
    );
  const filled = fillContractTemplate(t.body ?? "", input.values);
  if (filled.missing.length) throw new ValidationError(`Fill in: ${filled.missing.join(", ")}.`);
  const contract = await saveContract({
    values: {
      title: input.title,
      counterparty: input.counterparty,
      contract_type: t.contract_type,
      entity_id: input.entityId,
      status: "draft",
    },
    access: input.access,
    actorLabel: input.actorLabel,
  });
  const doc = await uploadOpsDocument({
    filename: `${input.title.replace(/[^\w -]/g, "").slice(0, 80) || "contract"}.txt`,
    buffer: Buffer.from(filled.text, "utf8"),
    category: "contract",
    title: `${input.title} (generated from ${t.name} v${t.version})`,
    entityId: input.entityId,
    contractId: contract.id,
    access: input.access,
    actorLabel: input.actorLabel,
  });
  await agentDb().update("ops_contracts", [eq("id", contract.id)], {
    template_id: t.id,
    document_id: doc.id,
  });
  return { contractId: contract.id, documentId: doc.id };
}

/** Structured first-pass review of the contract's stored text (not legal advice). */
export async function reviewContract(contractId: string, access: OpsAccess, actorLabel: string) {
  requireOps(access, "viewAll");
  const c = await selectOne<ContractRow>("ops_contracts", { filters: [eq("id", contractId)] });
  if (!c) throw new NotFoundError("Contract not found.");
  if (!c.document_id) throw new ValidationError("Upload the contract document first.");
  const doc = await getOpsDocument(c.document_id);
  if (!doc.extracted_text)
    throw new ValidationError(
      "No readable text was extracted from this document (scanned PDFs need OCR before review).",
    );
  const review = {
    ...reviewContractText(doc.extracted_text),
    reviewedAt: new Date().toISOString(),
    documentId: doc.id,
  };
  await agentDb().update("ops_contracts", [eq("id", c.id)], {
    review,
    status: c.status === "draft" ? "in_review" : c.status,
  });
  await recordAudit({
    actor: actor(access, actorLabel),
    action: "ops.contract_reviewed",
    targetType: "ops_contract",
    targetId: c.id,
    summary: `First-pass review of "${c.title}".`,
  });
  return review;
}

export async function requestContractSignature(input: {
  contractId: string;
  signers: Array<{ name: string; email: string }>;
  mode: "live" | "test";
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const c = await selectOne<ContractRow>("ops_contracts", {
    filters: [eq("id", input.contractId)],
  });
  if (!c?.document_id) throw new ValidationError("The contract has no document to send.");
  const signers = input.signers.filter((s) => s.name.trim() && /@/.test(s.email)).slice(0, 10);
  if (!signers.length) throw new ValidationError("Add at least one signer with an email address.");
  const doc = await getOpsDocument(c.document_id);
  return proposeAction({
    logicalKey: `contract-sign:${c.id}`,
    actionType: "docusign_send",
    title: `DocuSign: "${c.title}" to ${signers.map((s) => s.name).join(", ")}`,
    summary: `${c.contract_type} with ${c.counterparty}. Document: ${doc.filename} (v${doc.version}).`,
    payload: {
      register: "contract",
      refId: c.id,
      documentId: doc.id,
      emailSubject: `Please sign: ${c.title}`,
      signers,
    },
    display: {
      target: signers.map((s) => `${s.name} <${s.email}>`).join(", "),
      effect: "Sends a DocuSign envelope; status is tracked on the contract.",
      evidence: [`Document ${doc.filename} v${doc.version}`],
    },
    mode: input.mode,
    risk: "high",
    entityId: c.entity_id,
    requestedBy: actor(input.access, input.actorLabel),
  });
}

/** Poll DocuSign for contracts out for signature (called by the sweep). */
async function refreshSignatures(): Promise<number> {
  const out = await agentDb().select<ContractRow>("ops_contracts", {
    filters: [eq("status", "out_for_signature")],
  });
  let updated = 0;
  for (const c of out) {
    if (!c.docusign_envelope_id || c.docusign_envelope_id.startsWith("dry-run")) continue;
    try {
      const s = await docusignStatus(c.docusign_envelope_id);
      if (s.status !== c.signature_status) {
        await agentDb().update("ops_contracts", [eq("id", c.id)], {
          signature_status: s.status,
          ...(s.status === "completed" ? { status: "signed" } : {}),
        });
        updated++;
      }
    } catch {
      // Credentials missing or DocuSign unavailable: the contract keeps its last known status.
    }
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------
export type InsuranceRow = {
  id: string;
  entity_id: string | null;
  policy_number: string | null;
  insurer: string;
  category: string;
  effective_date: string | null;
  renewal_date: string | null;
  expiration_date: string | null;
  owner_profile_id: string | null;
  status: "active" | "renewing" | "renewed" | "expired" | "cancelled";
  reminder_days: number[];
  document_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export async function listInsurance(access: OpsAccess): Promise<InsuranceRow[]> {
  requireOps(access, "viewAll");
  return agentDb().select<InsuranceRow>("ops_insurance_policies", {
    order: { col: "renewal_date" },
  });
}

export async function saveInsurance(input: {
  id?: string;
  values: Record<string, unknown>;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const v = input.values;
  const patch = {
    entity_id: clip(v.entity_id, 40) || null,
    policy_number: clip(v.policy_number, 80) || null,
    insurer: clip(v.insurer, 160),
    category: clip(v.category, 120),
    effective_date: dateOrNull(v.effective_date),
    renewal_date: dateOrNull(v.renewal_date),
    expiration_date: dateOrNull(v.expiration_date),
    owner_profile_id: clip(v.owner_profile_id, 40) || null,
    status: ["active", "renewing", "renewed", "expired", "cancelled"].includes(String(v.status))
      ? String(v.status)
      : "active",
    reminder_days: reminderList(v.reminder_days),
    notes: clip(v.notes, 4000),
    document_id: clip(v.document_id, 40) || null,
  };
  if (!patch.insurer || !patch.category)
    throw new ValidationError("Enter the insurer and the type of coverage.");
  const [row] = input.id
    ? await agentDb().update<InsuranceRow>("ops_insurance_policies", [eq("id", input.id)], patch)
    : await agentDb().insert<InsuranceRow>("ops_insurance_policies", {
        ...patch,
        created_by: input.access.userId,
      });
  if (!row) throw new NotFoundError("Policy not found.");
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.insurance_saved",
    targetType: "ops_insurance",
    targetId: row.id,
    summary: `Saved ${row.category} policy with ${row.insurer}.`,
  });
  return row;
}

// ---------------------------------------------------------------------------
// Date reminders (contracts & insurance) — deduplicated, approval-controlled Slack notices
// ---------------------------------------------------------------------------
export async function raiseDateReminders(now = today()): Promise<number> {
  const roles = await getOpsRoles();
  let raised = 0;
  const items: Array<{
    refType: "contract" | "insurance";
    id: string;
    label: string;
    date: string | null;
    kind: string;
    days: number[];
    owner: string | null;
    entityId: string | null;
  }> = [];
  for (const c of await agentDb().select<ContractRow>("ops_contracts", {
    filters: [inList("status", ["signed", "active"])],
  })) {
    // Unverified dates never drive reminders (they may be wrong).
    if (!c.dates_verified) continue;
    const date = c.renewal_date ?? c.expiration_date;
    const noticeDate =
      date && c.notice_days
        ? new Date(Date.parse(date) - c.notice_days * 86_400_000).toISOString().slice(0, 10)
        : date;
    items.push({
      refType: "contract",
      id: c.id,
      label: `${c.title} (${c.counterparty})`,
      date: noticeDate,
      kind: c.notice_days ? "notice deadline" : c.renewal_date ? "renewal" : "expiration",
      days: c.reminder_days,
      owner: c.owner_profile_id ?? roles.contractReviewOwner,
      entityId: c.entity_id,
    });
  }
  for (const p of await agentDb().select<InsuranceRow>("ops_insurance_policies", {
    filters: [inList("status", ["active", "renewing"])],
  })) {
    items.push({
      refType: "insurance",
      id: p.id,
      label: `${p.category} — ${p.insurer}${p.policy_number ? ` #${p.policy_number}` : ""}`,
      date: p.renewal_date ?? p.expiration_date,
      kind: p.renewal_date ? "renewal" : "expiration",
      days: p.reminder_days,
      owner: p.owner_profile_id,
      entityId: p.entity_id,
    });
  }
  for (const item of items) {
    for (const threshold of dueReminderThresholds(item.date, item.days, now)) {
      try {
        await agentDb().insert("ops_reminders", {
          ref_type: item.refType,
          ref_id: item.id,
          threshold,
        });
      } catch {
        continue;
      }
      const ids = [
        item.owner,
        ...(threshold === "expired" || threshold === `${Math.min(...item.days)}d`
          ? [roles.ceo, roles.coo]
          : []),
      ].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);
      if (!ids.length) continue;
      const text =
        threshold === "expired"
          ? `${item.label}: the ${item.kind} date (${item.date}) has passed.`
          : `${item.label}: ${item.kind} on ${item.date} (${threshold.replace("d", " days")} or less).`;
      await proposeAction({
        logicalKey: `date-reminder:${item.refType}:${item.id}:${threshold}`,
        actionType: "notify_slack",
        title: `${item.refType === "contract" ? "Contract" : "Insurance"} ${item.kind}: ${item.label}`,
        summary: text,
        payload: { profileIds: ids, text },
        display: {
          target: "Owner" + (ids.length > 1 ? " and leadership" : ""),
          effect: "Sends a Slack reminder.",
        },
        mode: "live",
        risk: "low",
        entityId: item.entityId,
        requestedBy: { userId: null, label: "Sam (scheduled reminder)" },
      });
      raised++;
    }
  }
  return raised;
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------
export type SurveyRow = {
  id: string;
  entity_id: string | null;
  title: string;
  purpose: string;
  audience: string;
  questions: Array<{ key: string; text: string; type: "scale" | "choice" | "text" }>;
  schedule: string | null;
  owner_profile_id: string | null;
  confidentiality: "anonymous" | "confidential" | "identified";
  min_group_size: number;
  delivery: "bamboohr" | "manual";
  status: "draft" | "pending_approval" | "approved" | "in_progress" | "closed";
  invited_count: number | null;
  completed_count: number | null;
  results: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export async function listSurveys(access: OpsAccess): Promise<SurveyRow[]> {
  requireOps(access, "viewAll");
  return agentDb().select<SurveyRow>("ops_surveys", {
    order: { col: "created_at", ascending: false },
  });
}

export async function saveSurvey(input: {
  id?: string;
  values: Record<string, unknown>;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const v = input.values;
  const questions = (Array.isArray(v.questions) ? v.questions : [])
    .map((q: Record<string, unknown>, i: number) => ({
      key: clip(q.key, 40) || `q${i + 1}`,
      text: clip(q.text, 400),
      type: ["scale", "choice", "text"].includes(String(q.type)) ? String(q.type) : "scale",
    }))
    .filter((q) => q.text)
    .slice(0, 40);
  const patch = {
    entity_id: clip(v.entity_id, 40) || null,
    title: clip(v.title, 160),
    purpose: clip(v.purpose, 2000),
    audience: clip(v.audience, 400),
    questions,
    schedule: clip(v.schedule, 200) || null,
    owner_profile_id: clip(v.owner_profile_id, 40) || null,
    confidentiality: ["anonymous", "confidential", "identified"].includes(String(v.confidentiality))
      ? String(v.confidentiality)
      : "anonymous",
    min_group_size: Math.max(3, Math.min(50, Number(v.min_group_size) || 5)),
    // No public BambooHR survey API was found, so delivery is manual until one is confirmed.
    delivery: "manual",
  };
  if (!patch.title || !questions.length)
    throw new ValidationError("Give the survey a title and at least one question.");
  if (input.id) {
    const prev = await selectOne<SurveyRow>("ops_surveys", { filters: [eq("id", input.id)] });
    if (!prev) throw new NotFoundError("Survey not found.");
    if (!["draft", "pending_approval"].includes(prev.status))
      throw new ValidationError("An approved survey can't be edited; copy it instead.");
  }
  const [row] = input.id
    ? await agentDb().update<SurveyRow>("ops_surveys", [eq("id", input.id)], {
        ...patch,
        status: "draft",
      })
    : await agentDb().insert<SurveyRow>("ops_surveys", {
        ...patch,
        status: "draft",
        created_by: input.access.userId,
      });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.survey_saved",
    targetType: "ops_survey",
    targetId: row!.id,
    summary: `Saved survey "${row!.title}".`,
  });
  return row!;
}

export async function requestSurveyApproval(
  surveyId: string,
  access: OpsAccess,
  actorLabel: string,
) {
  requireOps(access, "configure");
  const s = await selectOne<SurveyRow>("ops_surveys", { filters: [eq("id", surveyId)] });
  if (!s) throw new NotFoundError("Survey not found.");
  await agentDb().update("ops_surveys", [eq("id", s.id)], { status: "pending_approval" });
  return proposeItemApproval({
    register: "survey",
    id: s.id,
    title: `Launch survey "${s.title}"`,
    summary: `${s.questions.length} questions · ${s.confidentiality} · results shown only for groups of ${s.min_group_size}+ · audience: ${s.audience || "not set"}`,
    snapshot: {
      questions: s.questions,
      confidentiality: s.confidentiality,
      minGroupSize: s.min_group_size,
      audience: s.audience,
    },
    effect: "The survey may be distributed (manually — BambooHR survey delivery isn't available).",
    access,
    actorLabel,
  });
}

/**
 * Record survey results. Raw responses are aggregated immediately and never stored; groups
 * smaller than the minimum size are suppressed.
 */
export async function recordSurveyResults(input: {
  surveyId: string;
  invited: number;
  responses: SurveyResponse[];
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const s = await selectOne<SurveyRow>("ops_surveys", { filters: [eq("id", input.surveyId)] });
  if (!s) throw new NotFoundError("Survey not found.");
  if (!["approved", "in_progress", "closed"].includes(s.status))
    throw new ValidationError("Results can only be recorded for an approved survey.");
  const aggregate = aggregateSurveyResponses(input.responses, s.min_group_size);
  await agentDb().update("ops_surveys", [eq("id", s.id)], {
    results: aggregate,
    invited_count: input.invited,
    completed_count: input.responses.length,
    status: "closed",
  });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.survey_results",
    targetType: "ops_survey",
    targetId: s.id,
    summary: `Recorded ${input.responses.length} responses for "${s.title}" (aggregated).`,
  });
  return aggregate;
}

// ---------------------------------------------------------------------------
// Vacancies & interviews
// ---------------------------------------------------------------------------
export type VacancyRow = {
  id: string;
  entity_id: string | null;
  title: string;
  department: string | null;
  location: string | null;
  description: string;
  status: "draft" | "pending_approval" | "approved" | "published" | "closed";
  publication_method: "betterteam_api" | "manual";
  posting_url: string | null;
  published_at: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
};
export type InterviewRow = {
  id: string;
  vacancy_id: string | null;
  candidate_name: string;
  candidate_email: string | null;
  selected_by: string | null;
  interviewer_profile_ids: string[];
  timezone: string;
  proposed_slots: Array<{ start: string; end: string }>;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status:
    | "requested"
    | "proposed"
    | "pending_approval"
    | "scheduled"
    | "rescheduling"
    | "cancelled"
    | "completed";
  calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listVacancies(access: OpsAccess) {
  requireOps(access, "viewAll");
  const [vacancies, interviews] = await Promise.all([
    agentDb().select<VacancyRow>("ops_vacancies", {
      order: { col: "created_at", ascending: false },
    }),
    agentDb().select<InterviewRow>("ops_interviews", {
      order: { col: "created_at", ascending: false },
    }),
  ]);
  return { vacancies, interviews };
}

export async function saveVacancy(input: {
  id?: string;
  values: Record<string, unknown>;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const v = input.values;
  const patch = {
    entity_id: clip(v.entity_id, 40) || null,
    title: clip(v.title, 160),
    department: clip(v.department, 120) || null,
    location: clip(v.location, 160) || null,
    description: clip(v.description, 20_000),
    publication_method: "manual",
  };
  if (!patch.title || !patch.description)
    throw new ValidationError("Enter the job title and description.");
  const [row] = input.id
    ? await agentDb().update<VacancyRow>(
        "ops_vacancies",
        [eq("id", input.id), inList("status", ["draft", "pending_approval"])],
        { ...patch, status: "draft" },
      )
    : await agentDb().insert<VacancyRow>("ops_vacancies", {
        ...patch,
        status: "draft",
        requested_by: input.access.userId,
      });
  if (!row)
    throw new ValidationError(
      "Published vacancies can't be edited here; change the posting in BetterTeams.",
    );
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.vacancy_saved",
    targetType: "ops_vacancy",
    targetId: row.id,
    summary: `Saved vacancy "${row.title}".`,
  });
  return row;
}

/** Publishing is approval-controlled; BetterTeams has no supported API, so it lands as a manual task. */
export async function requestVacancyPublication(
  vacancyId: string,
  access: OpsAccess,
  actorLabel: string,
  mode: "live" | "test" = "live",
) {
  requireOps(access, "configure");
  const v = await selectOne<VacancyRow>("ops_vacancies", { filters: [eq("id", vacancyId)] });
  if (!v) throw new NotFoundError("Vacancy not found.");
  await agentDb().update("ops_vacancies", [eq("id", v.id)], { status: "pending_approval" });
  return proposeAction({
    logicalKey: `vacancy:${v.id}`,
    actionType: "publish_vacancy",
    title: `Publish job: ${v.title}`,
    summary: v.description.slice(0, 600),
    payload: {
      register: "vacancy",
      refId: v.id,
      title: v.title,
      department: v.department,
      location: v.location,
      description: v.description,
    },
    display: {
      target: "BetterTeams (manual publication)",
      effect:
        "After approval, a person publishes this exact text in BetterTeams and records the link.",
    },
    mode,
    risk: "medium",
    entityId: v.entity_id,
    requestedBy: actor(access, actorLabel),
  });
}

export async function recordVacancyPosting(
  vacancyId: string,
  postingUrl: string,
  access: OpsAccess,
  actorLabel: string,
) {
  requireOps(access, "configure");
  if (!/^https?:\/\//.test(postingUrl)) throw new ValidationError("Enter the posting's link.");
  const v = await selectOne<VacancyRow>("ops_vacancies", { filters: [eq("id", vacancyId)] });
  if (!v || !["approved", "published"].includes(v.status))
    throw new ValidationError("Only approved vacancies can be marked published.");
  await agentDb().update("ops_vacancies", [eq("id", v.id)], {
    status: "published",
    posting_url: postingUrl.slice(0, 500),
    published_at: new Date().toISOString(),
  });
  await recordAudit({
    actor: actor(access, actorLabel),
    action: "ops.vacancy_published",
    targetType: "ops_vacancy",
    targetId: v.id,
    summary: `"${v.title}" published at ${postingUrl.slice(0, 120)}.`,
  });
}

export async function createInterview(input: {
  vacancyId: string | null;
  candidateName: string;
  candidateEmail: string;
  interviewerIds: string[];
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  if (!input.candidateName.trim()) throw new ValidationError("Enter the candidate's name.");
  if (!input.interviewerIds.length) throw new ValidationError("Choose at least one interviewer.");
  const roles = await getOpsRoles();
  const [row] = await agentDb().insert<InterviewRow>("ops_interviews", {
    vacancy_id: input.vacancyId,
    candidate_name: input.candidateName.slice(0, 160),
    candidate_email: input.candidateEmail.slice(0, 200) || null,
    selected_by: input.access.userId,
    interviewer_profile_ids: input.interviewerIds.slice(0, 6),
    timezone: roles.timezone,
    proposed_slots: [],
    status: "requested",
  });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.interview_requested",
    targetType: "ops_interview",
    targetId: row!.id,
    summary: `Interview requested with ${row!.candidate_name}.`,
  });
  return row!;
}

/** Find free slots from interviewers' calendars (needs Google Calendar permission) — or say so. */
export async function proposeInterviewSlots(
  interviewId: string,
  access: OpsAccess,
  durationMinutes = 45,
) {
  requireOps(access, "configure");
  const iv = await selectOne<InterviewRow>("ops_interviews", { filters: [eq("id", interviewId)] });
  if (!iv) throw new NotFoundError("Interview not found.");
  const { scopes } = await googleScopes().catch(() => ({ scopes: null as string[] | null }));
  if (!(scopes ?? []).some((s) => s.includes("calendar"))) {
    return {
      slots: [],
      manual:
        "Google Calendar access hasn't been granted, so availability can't be checked. Agree a time with the interviewers and enter it by hand.",
    };
  }
  const emails = [...(await loadAuthEmailsByUserIds(iv.interviewer_profile_ids)).values()];
  const from = new Date(Date.now() + 86_400_000).toISOString();
  const to = new Date(Date.now() + 8 * 86_400_000).toISOString();
  const busyMap = await calendarFreeBusy({
    calendars: emails,
    timeMin: from,
    timeMax: to,
    timeZone: iv.timezone,
  });
  const offset = -Math.round(
    (Date.parse(new Date().toLocaleString("en-US", { timeZone: "UTC" })) -
      Date.parse(new Date().toLocaleString("en-US", { timeZone: iv.timezone }))) /
      60_000,
  );
  const slots = proposeFreeSlots({
    busy: Object.values(busyMap).flat(),
    from,
    days: 7,
    durationMinutes,
    dayStartHour: 9,
    dayEndHour: 17,
    utcOffsetMinutes: offset,
  });
  await agentDb().update("ops_interviews", [eq("id", iv.id)], {
    proposed_slots: slots,
    status: "proposed",
  });
  return { slots, manual: null };
}

/** Booking an interview creates a calendar invitation — approval-controlled. */
export async function requestInterviewBooking(input: {
  interviewId: string;
  start: string;
  end: string;
  calendarId: string;
  mode: "live" | "test";
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "configure");
  const iv = await selectOne<InterviewRow>("ops_interviews", {
    filters: [eq("id", input.interviewId)],
  });
  if (!iv) throw new NotFoundError("Interview not found.");
  if (!(Date.parse(input.start) < Date.parse(input.end)))
    throw new ValidationError("Choose a valid time.");
  const interviewers = [...(await loadAuthEmailsByUserIds(iv.interviewer_profile_ids)).values()];
  const attendees = [...interviewers, ...(iv.candidate_email ? [iv.candidate_email] : [])];
  await agentDb().update("ops_interviews", [eq("id", iv.id)], { status: "pending_approval" });
  return proposeAction({
    logicalKey: `interview:${iv.id}`,
    actionType: "calendar_event",
    title: `Interview: ${iv.candidate_name}`,
    summary: `${new Date(input.start).toLocaleString("en-US", { timeZone: iv.timezone })} (${iv.timezone}) with ${attendees.length} attendee(s).`,
    payload: {
      register: "interview",
      refId: iv.id,
      calendarId: input.calendarId || "primary",
      summary: `Interview: ${iv.candidate_name}`,
      description: "Scheduled by Sam on behalf of Acton.",
      start: input.start,
      end: input.end,
      timeZone: iv.timezone,
      attendees,
    },
    display: {
      target: attendees.join(", "),
      effect: "Creates the calendar invitation after re-checking for conflicts.",
    },
    mode: input.mode,
    risk: "medium",
    requestedBy: actor(input.access, input.actorLabel),
  });
}

/** Record a time agreed outside Baxter (manual fallback). */
export async function recordInterviewTime(
  interviewId: string,
  start: string,
  end: string,
  access: OpsAccess,
  actorLabel: string,
) {
  requireOps(access, "configure");
  await agentDb().update("ops_interviews", [eq("id", interviewId)], {
    scheduled_start: start,
    scheduled_end: end,
    status: "scheduled",
  });
  await recordAudit({
    actor: actor(access, actorLabel),
    action: "ops.interview_scheduled",
    targetType: "ops_interview",
    targetId: interviewId,
    summary: "Interview time recorded manually.",
  });
}

// ---------------------------------------------------------------------------
// Timecards (read-only checks; never payroll)
// ---------------------------------------------------------------------------
export type TimecardCheckRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: "unavailable" | "complete" | "incomplete" | "manual";
  source: string;
  summary: Record<string, unknown>;
  created_at: string;
};

export function lastWeek(now = new Date()): { start: string; end: string } {
  const day = now.getUTCDay();
  const end = new Date(now.getTime() - ((day + 7) % 7 || 7) * 86_400_000); // previous Sunday
  const start = new Date(end.getTime() - 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function listTimecardChecks(access: OpsAccess): Promise<TimecardCheckRow[]> {
  requireOps(access, "viewAll");
  return agentDb().select<TimecardCheckRow>("ops_timecard_checks", {
    order: { col: "period_start", ascending: false },
    limit: 52,
  });
}

/**
 * Check timecard completeness for a period. JobTread currently has no time entries, so this
 * records "unavailable" honestly instead of guessing; follow-up stays manual.
 */
export async function runTimecardCheck(period = lastWeek()): Promise<TimecardCheckRow | null> {
  const existing = await selectOne<TimecardCheckRow>("ops_timecard_checks", {
    filters: [eq("period_start", period.start), eq("period_end", period.end)],
  });
  if (existing) return existing;
  const count = await jobtreadTimeEntryCount().catch(() => null);
  const cutoff = await decisionValue("timecard_cutoff");
  const summary =
    count === null
      ? { message: "JobTread couldn't be reached.", cutoff }
      : count === 0
        ? {
            message:
              "JobTread has no time entries at all, so completeness can't be checked. Follow up manually until crews log time in JobTread.",
            cutoff,
            entries: 0,
          }
        : {
            message: `JobTread has ${count} time entries. Per-employee completeness needs the expected-hours rules from leadership before Sam can flag missing timecards.`,
            cutoff,
            entries: count,
          };
  const [row] = await agentDb().insert<TimecardCheckRow>("ops_timecard_checks", {
    period_start: period.start,
    period_end: period.end,
    status: count ? "manual" : "unavailable",
    source: "jobtread",
    summary,
  });
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Autonomy rules (leadership-only; off by default; revocable immediately)
// ---------------------------------------------------------------------------
export type AutonomyRow = {
  id: string;
  action_type: string;
  workflow_key: string | null;
  entity_id: string | null;
  enabled: boolean;
  enabled_by: string | null;
  enabled_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  note: string;
  created_at: string;
};

export async function listAutonomyRules(): Promise<AutonomyRow[]> {
  return agentDb().select<AutonomyRow>("ops_autonomy_rules", {
    order: { col: "created_at", ascending: false },
  });
}

export async function enableAutonomy(input: {
  actionType: string;
  workflowKey: string | null;
  entityId: string | null;
  note: string;
  access: OpsAccess;
  actorLabel: string;
}) {
  requireOps(input.access, "leadership");
  if (!(ACTION_TYPES as readonly string[]).includes(input.actionType))
    throw new ValidationError("Unknown action type.");
  if (input.actionType === "bamboohr_update" || input.actionType === "docusign_send")
    throw new ValidationError(
      "BambooHR changes and signature requests always need per-action approval.",
    );
  if (input.note.trim().length < 5)
    throw new ValidationError("Record why this autonomy is allowed.");
  const [row] = await agentDb().insert<AutonomyRow>("ops_autonomy_rules", {
    action_type: input.actionType,
    workflow_key: input.workflowKey,
    entity_id: input.entityId,
    enabled: true,
    enabled_by: input.access.userId,
    enabled_at: new Date().toISOString(),
    note: input.note.slice(0, 500),
  });
  await recordAudit({
    actor: actor(input.access, input.actorLabel),
    action: "ops.autonomy_enabled",
    targetType: "ops_autonomy",
    targetId: row!.id,
    summary: `Enabled autonomy for ${input.actionType}${input.workflowKey ? ` in ${input.workflowKey}` : ""}.`,
  });
  return row!;
}

export async function revokeAutonomy(id: string, access: OpsAccess, actorLabel: string) {
  requireOps(access, "leadership");
  await agentDb().update("ops_autonomy_rules", [eq("id", id)], {
    enabled: false,
    revoked_by: access.userId,
    revoked_at: new Date().toISOString(),
  });
  await recordAudit({
    actor: actor(access, actorLabel),
    action: "ops.autonomy_revoked",
    targetType: "ops_autonomy",
    targetId: id,
    summary: "Revoked an autonomy rule.",
  });
}

// ---------------------------------------------------------------------------
// Item approvals & action outcomes for register-backed actions
// ---------------------------------------------------------------------------
async function proposeItemApproval(input: {
  register: "survey" | "contract_template";
  id: string;
  title: string;
  summary: string;
  snapshot: Record<string, unknown>;
  effect: string;
  access: OpsAccess;
  actorLabel: string;
}): Promise<ActionRow> {
  const action = await proposeAction({
    logicalKey: `item:${input.register}:${input.id}`,
    actionType: "approve_item",
    title: input.title,
    summary: input.summary,
    payload: { register: input.register, refId: input.id, snapshot: input.snapshot },
    display: { target: input.title, effect: input.effect },
    mode: "live",
    risk: "medium",
    requestedBy: actor(input.access, input.actorLabel),
  });
  if (action.status === "approved") await executeAction(action.id);
  return action;
}

export async function onRegisterActionSettled(action: ActionRow): Promise<void> {
  const p = action.payload;
  const refId = String(p.refId ?? "");
  const ok = action.status === "succeeded";
  const declined = ["rejected", "cancelled", "superseded"].includes(action.status);
  switch (p.register) {
    case "survey":
      if (ok)
        await agentDb().update("ops_surveys", [eq("id", refId), eq("status", "pending_approval")], {
          status: "approved",
        });
      if (declined && action.status !== "superseded")
        await agentDb().update("ops_surveys", [eq("id", refId), eq("status", "pending_approval")], {
          status: "draft",
        });
      return;
    case "contract_template":
      if (ok) {
        const t = await selectOne<ContractTemplateRow>("ops_contract_templates", {
          filters: [eq("id", refId)],
        });
        if (!t) return;
        // Approving a new version retires the previous approved version of the same template name.
        const older = await agentDb().select<ContractTemplateRow>("ops_contract_templates", {
          filters: [eq("name", t.name), eq("status", "approved")],
        });
        for (const o of older)
          if (o.id !== t.id)
            await agentDb().update("ops_contract_templates", [eq("id", o.id)], {
              status: "inactive",
            });
        await agentDb().update("ops_contract_templates", [eq("id", refId)], {
          status: "approved",
          approved_by: await approverOf(action),
          approved_at: new Date().toISOString(),
        });
      }
      return;
    case "vacancy":
      if (action.status === "manual_required" || ok)
        await agentDb().update(
          "ops_vacancies",
          [eq("id", refId), eq("status", "pending_approval")],
          { status: "approved" },
        );
      if (declined && action.status !== "superseded")
        await agentDb().update(
          "ops_vacancies",
          [eq("id", refId), eq("status", "pending_approval")],
          { status: "draft" },
        );
      return;
    case "interview":
      if (ok)
        await agentDb().update("ops_interviews", [eq("id", refId)], {
          status: "scheduled",
          scheduled_start: String(p.start),
          scheduled_end: String(p.end),
          calendar_event_id: String(
            (action.result as { id?: string } | null)?.id ??
              (action.mode === "test" ? "dry-run" : ""),
          ),
        });
      if (declined && action.status !== "superseded")
        await agentDb().update(
          "ops_interviews",
          [eq("id", refId), eq("status", "pending_approval")],
          { status: "proposed" },
        );
      return;
    case "contract":
      if (ok) {
        const envelope = String(
          (action.result as { envelopeId?: string } | null)?.envelopeId ??
            (action.mode === "test" ? "dry-run" : ""),
        );
        await agentDb().update("ops_contracts", [eq("id", refId)], {
          status: "out_for_signature",
          signature_status: action.mode === "test" ? "simulated" : "sent",
          docusign_envelope_id: envelope || null,
        });
      }
      return;
  }
}

async function approverOf(action: ActionRow): Promise<string | null> {
  if (!action.approval_request_id) return null;
  return (
    (
      await selectOne<{ decided_by: string | null }>("ai_approval_requests", {
        filters: [eq("id", action.approval_request_id)],
      })
    )?.decided_by ?? null
  );
}

/** Sweep hook for the registers. */
export async function sweepRegisters(): Promise<Record<string, number>> {
  const signatures = await refreshSignatures();
  let timecards = 0;
  // Weekly check runs only once leadership has confirmed the cutoff (no invented policy).
  if (await decisionValue("timecard_cutoff")) timecards = (await runTimecardCheck()) ? 1 : 0;
  // Keep the BambooHR refresh token exercised so nobody has to reconnect.
  const bamboo = await import("@/lib/bamboohr/connection")
    .then((m) => m.keepAlive())
    .catch(() => "failed" as const);
  return { signatures, timecards, bamboohrRefreshed: bamboo === "refreshed" ? 1 : 0 };
}
