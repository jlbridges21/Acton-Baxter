/**
 * Starter workflows for Sam Operations Studio. They are seeded as UNOFFICIAL DRAFTS built from
 * the leadership brief's scope — not Acton's approved procedures. Leadership must supply the
 * official checklists, edit these, and publish them before they can run.
 */

import "server-only";

import { agentDb, eq, selectOne } from "@/lib/agents/store";
import { workflowDefinitionSchema, type WorkflowDefinition } from "./definition";

type Starter = {
  key: string;
  name: string;
  category: string;
  description: string;
  definition: unknown;
};

const DRAFT_NOTE =
  "Starter draft from the leadership brief — replace with Acton's official checklist before publishing.";

export const STARTER_WORKFLOWS: Starter[] = [
  {
    key: "employee-onboarding",
    name: "Employee onboarding",
    category: "onboarding",
    description: `Approved hire → paperwork, records, access (COO), finance handoff, first day, 30-day check-in. ${DRAFT_NOTE}`,
    definition: {
      anchor: "start_date",
      inputs: [
        { key: "start_date", label: "Start date", type: "date", required: true },
        { key: "position", label: "Position", type: "text", required: true },
        { key: "hiring_manager", label: "Hiring manager", type: "person", required: false },
      ],
      stages: ["Before start", "First day", "First month"],
      steps: [
        {
          key: "confirm-details",
          title: "Confirm new-hire details",
          type: "collect_information",
          stage: "Before start",
          dueOffsetDays: -10,
          fields: [
            { key: "work_location", label: "Work location" },
            { key: "equipment", label: "Equipment needed", required: false },
          ],
          reminder: { everyDays: 2, escalateAfterDays: 4 },
        },
        {
          key: "offer-letter",
          title: "Upload signed offer letter",
          type: "upload_document",
          stage: "Before start",
          documentCategory: "signed_offer_letter",
          dueOffsetDays: -7,
        },
        {
          key: "verify-offer",
          title: "Verify the signed offer letter",
          type: "verify_document",
          stage: "Before start",
          dependsOn: ["offer-letter"],
          dueOffsetDays: -6,
        },
        {
          key: "welcome-email",
          title: "Send welcome email",
          type: "communication",
          stage: "Before start",
          dependsOn: ["confirm-details"],
          dueOffsetDays: -5,
          message: {
            channel: "email",
            recipient: "employee",
            subject: "Welcome to {{entity_name}}, {{first_name}}",
            body: "Hi {{first_name}},\n\nWelcome aboard! Your first day as {{position}} is {{start_date}} at {{work_location}}. We'll send details about your first week shortly.\n\n— Acton",
          },
        },
        {
          key: "payroll-handoff",
          title: "New-hire payroll setup (finance)",
          type: "finance_handoff",
          stage: "Before start",
          assignee: { role: "finance_owner", profileId: null },
          dependsOn: ["verify-offer"],
          dueOffsetDays: -3,
          description:
            "Finance completes payroll and benefits setup. Sam never executes finance steps.",
          evidenceRequired: true,
        },
        {
          key: "system-access",
          title: "Provision system access",
          type: "access_request",
          stage: "Before start",
          assignee: { role: "coo", profileId: null },
          dependsOn: ["confirm-details"],
          dueOffsetDays: -1,
          checklist: ["Email account", "Slack", "JobTread", "Google Drive folders"],
          description:
            "The COO provisions access and records what was granted. Sam never grants access.",
          evidenceRequired: true,
          reminder: { everyDays: 1, escalateAfterDays: 2 },
        },
        {
          key: "file-offer",
          title: "File the offer letter in Drive",
          type: "external_action",
          stage: "Before start",
          dependsOn: ["verify-offer"],
          action: {
            type: "drive_file",
            settings: { documentCategory: "signed_offer_letter", folder: "employee_documents" },
          },
        },
        {
          key: "first-day",
          title: "First-day checklist",
          type: "checklist",
          stage: "First day",
          dependsOn: ["system-access", "welcome-email"],
          dueOffsetDays: 0,
          checklist: ["Introductions", "Safety orientation", "Equipment handed over"],
        },
        {
          key: "thirty-day",
          title: "30-day check-in",
          type: "manual_task",
          stage: "First month",
          assignee: { role: "hiring_manager", profileId: null },
          dependsOn: ["first-day"],
          dueOffsetDays: 30,
          evidenceRequired: true,
        },
        {
          key: "complete",
          title: "Onboarding complete",
          type: "milestone",
          stage: "First month",
          dependsOn: ["thirty-day", "payroll-handoff", "file-offer"],
        },
      ],
    },
  },
  {
    key: "employee-offboarding",
    name: "Employee offboarding",
    category: "offboarding",
    description: `Confirmed departure → leadership confirmation, finance handoff, access removal (COO), equipment, records. ${DRAFT_NOTE}`,
    definition: {
      anchor: "end_date",
      inputs: [{ key: "end_date", label: "Last day", type: "date", required: true }],
      stages: ["Before last day", "Last day", "After"],
      steps: [
        {
          key: "confirm",
          title: "Leadership confirms the offboarding",
          type: "approval",
          stage: "Before last day",
          assignee: { role: "leadership", profileId: null },
        },
        {
          key: "final-pay",
          title: "Final pay and benefits (finance)",
          type: "finance_handoff",
          stage: "Before last day",
          assignee: { role: "finance_owner", profileId: null },
          dependsOn: ["confirm"],
          dueOffsetDays: -3,
          evidenceRequired: true,
        },
        {
          key: "remove-access",
          title: "Remove system access",
          type: "access_request",
          stage: "Last day",
          assignee: { role: "coo", profileId: null },
          dependsOn: ["confirm"],
          dueOffsetDays: 0,
          checklist: ["Email", "Slack", "JobTread", "Google Drive", "Building/vehicle keys"],
          evidenceRequired: true,
          reminder: { everyDays: 1, escalateAfterDays: 1 },
        },
        {
          key: "equipment",
          title: "Collect company equipment",
          type: "checklist",
          stage: "Last day",
          dependsOn: ["confirm"],
          dueOffsetDays: 0,
          checklist: ["Laptop/tablet", "Phone", "Tools", "Vehicle"],
        },
        {
          key: "bamboohr",
          title: "Record the departure in BambooHR",
          type: "manual_task",
          stage: "After",
          dependsOn: ["confirm"],
          dueOffsetDays: 1,
          description:
            "Termination and status fields are excluded from Sam's BambooHR access, so this stays a manual step.",
          evidenceRequired: true,
        },
        {
          key: "separation-docs",
          title: "Upload separation documents",
          type: "upload_document",
          stage: "After",
          dependsOn: ["confirm"],
          documentCategory: "separation_documents",
          dueOffsetDays: 2,
        },
        {
          key: "file-docs",
          title: "File separation documents in Drive",
          type: "external_action",
          stage: "After",
          dependsOn: ["separation-docs"],
          action: {
            type: "drive_file",
            settings: { documentCategory: "separation_documents", folder: "employee_documents" },
          },
        },
        {
          key: "complete",
          title: "Offboarding complete",
          type: "milestone",
          stage: "After",
          dependsOn: ["final-pay", "remove-access", "equipment", "bamboohr", "file-docs"],
        },
      ],
    },
  },
  {
    key: "job-publication",
    name: "Job publication",
    category: "recruitment",
    description: `Vacancy details → leadership approval → manual BetterTeams publication (no supported API). ${DRAFT_NOTE}`,
    definition: {
      anchor: "workflow_start",
      inputs: [{ key: "job_title", label: "Job title", type: "text", required: true }],
      steps: [
        {
          key: "details",
          title: "Collect job details",
          type: "collect_information",
          assignee: { role: "hiring_manager", profileId: null },
          fields: [
            { key: "location", label: "Location" },
            { key: "description", label: "Job description" },
          ],
          dueOffsetDays: 3,
        },
        {
          key: "approve",
          title: "Approve the job listing",
          type: "approval",
          assignee: { role: "leadership", profileId: null },
          dependsOn: ["details"],
        },
        {
          key: "publish",
          title: "Publish in BetterTeams and record the link",
          type: "manual_task",
          dependsOn: ["approve"],
          evidenceRequired: true,
          description:
            "BetterTeams has no supported API. Publish the approved text exactly and paste the posting link as evidence.",
          dueOffsetDays: 5,
        },
        { key: "done", title: "Listing live", type: "milestone", dependsOn: ["publish"] },
      ],
    },
  },
  {
    key: "interview-scheduling",
    name: "Interview scheduling",
    category: "recruitment",
    description: `Candidate selected → availability → approved calendar invitation (Recruitment tab). ${DRAFT_NOTE}`,
    definition: {
      anchor: "workflow_start",
      inputs: [{ key: "candidate_name", label: "Candidate", type: "text", required: true }],
      steps: [
        {
          key: "candidate",
          title: "Confirm candidate contact details",
          type: "collect_information",
          fields: [
            { key: "candidate_email", label: "Candidate email" },
            { key: "interviewers", label: "Interviewers" },
          ],
          dueOffsetDays: 1,
        },
        {
          key: "schedule",
          title: "Schedule the interview (Recruitment tab)",
          type: "manual_task",
          dependsOn: ["candidate"],
          description:
            "Propose slots from interviewers' calendars, then request the approved invitation.",
          evidenceRequired: true,
          dueOffsetDays: 3,
        },
        { key: "done", title: "Interview scheduled", type: "milestone", dependsOn: ["schedule"] },
      ],
    },
  },
  {
    key: "timecard-follow-up",
    name: "Weekly timecard follow-up",
    category: "timecards",
    description: `Check completeness, follow up, report status to finance. Sam never runs payroll. ${DRAFT_NOTE}`,
    definition: {
      anchor: "target_date",
      inputs: [{ key: "target_date", label: "Week ending", type: "date", required: true }],
      steps: [
        {
          key: "check",
          title: "Check timecards for the week",
          type: "manual_task",
          dueOffsetDays: 1,
          description:
            "JobTread has no time entries yet, so completeness is checked by hand until crews log time there.",
          evidenceRequired: true,
        },
        {
          key: "status",
          title: "Share timecard status with leadership",
          type: "communication",
          dependsOn: ["check"],
          message: {
            channel: "slack",
            recipient: "leadership",
            subject: "Timecards — week ending {{target_date}}",
            body: "Timecard check for the week ending {{target_date}} is done. Details are in Sam Operations → Timecards.",
          },
        },
        {
          key: "finance",
          title: "Hand timecard status to finance",
          type: "finance_handoff",
          assignee: { role: "finance_owner", profileId: null },
          dependsOn: ["check"],
          dueOffsetDays: 2,
          description: "Finance owns payroll. Sam only reports status.",
        },
      ],
    },
  },
  {
    key: "contract-signature",
    name: "Contract signature",
    category: "contracts",
    description: `Draft → review → leadership approval → DocuSign (Contracts tab) → filed. ${DRAFT_NOTE}`,
    definition: {
      anchor: "workflow_start",
      inputs: [
        { key: "contract_title", label: "Contract", type: "text", required: true },
        { key: "counterparty", label: "Counterparty", type: "text", required: true },
      ],
      steps: [
        {
          key: "upload",
          title: "Upload the contract",
          type: "upload_document",
          documentCategory: "contract",
          dueOffsetDays: 1,
        },
        {
          key: "review",
          title: "Review key terms",
          type: "manual_task",
          assignee: { role: "leadership", profileId: null },
          dependsOn: ["upload"],
          description:
            "Use Sam's first-pass review on the Contracts tab; escalate legal questions to counsel.",
          evidenceRequired: true,
          dueOffsetDays: 5,
        },
        {
          key: "approve",
          title: "Approve for signature",
          type: "approval",
          assignee: { role: "leadership", profileId: null },
          dependsOn: ["review"],
        },
        {
          key: "send",
          title: "Send for signature (Contracts tab)",
          type: "manual_task",
          dependsOn: ["approve"],
          description:
            "Request the DocuSign envelope from the contract record; it is approval-controlled.",
          evidenceRequired: true,
        },
        { key: "done", title: "Signed and filed", type: "milestone", dependsOn: ["send"] },
      ],
    },
  },
  {
    key: "contract-renewal",
    name: "Contract renewal",
    category: "contracts",
    description: `Renewal date approaching → review → decision → renewal or notice. ${DRAFT_NOTE}`,
    definition: {
      anchor: "target_date",
      inputs: [
        { key: "target_date", label: "Renewal or notice date", type: "date", required: true },
        { key: "contract_title", label: "Contract", type: "text", required: true },
      ],
      steps: [
        {
          key: "review",
          title: "Review terms and performance",
          type: "manual_task",
          assignee: { role: "leadership", profileId: null },
          dueOffsetDays: -45,
          evidenceRequired: true,
          reminder: { everyDays: 7, escalateAfterDays: 14 },
        },
        {
          key: "decide",
          title: "Renew, renegotiate, or end",
          type: "approval",
          assignee: { role: "leadership", profileId: null },
          dependsOn: ["review"],
        },
        {
          key: "act",
          title: "Carry out the decision",
          type: "manual_task",
          dependsOn: ["decide"],
          dueOffsetDays: -7,
          evidenceRequired: true,
        },
        { key: "done", title: "Renewal handled", type: "milestone", dependsOn: ["act"] },
      ],
    },
  },
  {
    key: "insurance-renewal",
    name: "Insurance renewal",
    category: "insurance",
    description: `Renewal approaching → quote → finance (premium) → approval → new certificate on file. ${DRAFT_NOTE}`,
    definition: {
      anchor: "target_date",
      inputs: [
        { key: "target_date", label: "Renewal date", type: "date", required: true },
        { key: "policy", label: "Policy", type: "text", required: true },
      ],
      steps: [
        {
          key: "quote",
          title: "Collect the renewal quote",
          type: "collect_information",
          dueOffsetDays: -45,
          fields: [
            { key: "insurer", label: "Insurer" },
            { key: "coverage_changes", label: "Coverage changes", required: false },
          ],
          reminder: { everyDays: 7, escalateAfterDays: 14 },
        },
        {
          key: "approve",
          title: "Approve the renewal",
          type: "approval",
          assignee: { role: "leadership", profileId: null },
          dependsOn: ["quote"],
        },
        {
          key: "premium",
          title: "Premium payment (finance)",
          type: "finance_handoff",
          assignee: { role: "finance_owner", profileId: null },
          dependsOn: ["approve"],
          dueOffsetDays: -10,
          evidenceRequired: true,
        },
        {
          key: "certificate",
          title: "Upload the new certificate",
          type: "upload_document",
          dependsOn: ["premium"],
          documentCategory: "insurance_certificate",
          dueOffsetDays: 0,
        },
        { key: "done", title: "Renewal complete", type: "milestone", dependsOn: ["certificate"] },
      ],
    },
  },
];

/** Seed missing starters as unofficial drafts. Never overwrites an existing workflow. */
export async function ensureStarterWorkflows(): Promise<number> {
  let created = 0;
  for (const s of STARTER_WORKFLOWS) {
    if (await selectOne("ops_workflow_templates", { filters: [eq("key", s.key)] })) continue;
    const definition: WorkflowDefinition = workflowDefinitionSchema.parse(s.definition);
    let t: { id: string } | undefined;
    try {
      [t] = await agentDb().insert<{ id: string }>("ops_workflow_templates", {
        key: s.key,
        name: s.name,
        category: s.category,
        description: s.description,
        status: "draft",
        official: false,
        published_version_id: null,
        created_by: null,
      });
    } catch {
      continue; // created concurrently
    }
    await agentDb().insert("ops_workflow_versions", {
      template_id: t!.id,
      version: 1,
      status: "draft",
      definition,
      change_summary: "Starter draft (unofficial)",
      created_by: null,
    });
    created++;
  }
  return created;
}
