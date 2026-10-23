/**
 * Tool registry for AI Workforce agents.
 *
 * Tools are implemented by engineers in code. The Admin Studio can only enable or disable
 * tools listed here as available for an agent. Each tool declares a risk level and a
 * code-level approval minimum that configuration cannot lower.
 *
 * Tools run with the effective access of the requester AND the agent: every tool receives
 * the requester's resolved access levels for this agent and filters data accordingly.
 */

import "server-only";

import { z } from "zod";
import { createApproval } from "./approvals";
import { searchAgentKnowledge } from "./knowledge";
import { REPORT_INTEL_TOOLS } from "./report-intel-tools";
import { REPORT_TOOLS } from "./report-tools";
import {
  getInstance,
  getTemplate,
  listInstances,
  listTemplates,
  summarizeProgress,
} from "./onboarding";
import type { AccessLevel, Requester, ResolvedAgent, TaskRow } from "./types";

export type ToolRisk = "read" | "draft" | "write" | "external";

export type ToolContext = {
  task: TaskRow;
  agent: ResolvedAgent;
  requester: Requester;
  access: Set<AccessLevel>;
};

export type ToolSource = { documentId: string | null; title: string; excerpt: string };

export type ToolResult = {
  /** Compact JSON-able data handed back to the model (treated as untrusted data). */
  data: unknown;
  /** One-line, non-sensitive summary for the task log. */
  logSummary: string;
  sources?: ToolSource[];
  approvalId?: string;
  /** A saved output the tool created or changed (verified by the tool, not the model). */
  artifact?: { type: "report"; id: string; title: string; url: string; version: number };
};

export type AgentTool = {
  key: string;
  label: string;
  /** Plain-English description for admins. */
  description: string;
  /** Description + argument shape for the model. */
  modelUsage: string;
  risk: ToolRisk;
  /** Code-level minimum: always routes through human approval regardless of config. */
  alwaysRequiresApproval: boolean;
  /** False for planned integrations that are not built yet (shown but not selectable). */
  available: boolean;
  unavailableReason?: string;
  args: z.ZodType;
  execute: (ctx: ToolContext, args: unknown) => Promise<ToolResult>;
};

const knowledgeSearch: AgentTool = {
  key: "knowledge_search",
  label: "Search approved documents",
  description:
    "Search the documents assigned to this agent in the Knowledge Hub, limited to what the requester may see.",
  modelUsage:
    'knowledge_search {"query": string} — search approved company documents. Returns excerpts with document titles and ids.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ query: z.string().trim().min(2).max(400) }),
  async execute(ctx, raw) {
    const { query } = this.args.parse(raw) as { query: string };
    const { hits, searchedDocuments } = await searchAgentKnowledge({
      agentId: ctx.agent.row.id,
      access: ctx.access,
      query,
      limit: ctx.agent.config.knowledge.maxChunksPerQuery,
    });
    return {
      data: {
        searchedDocuments,
        results: hits.map((h) => ({
          documentId: h.documentId,
          documentTitle: h.documentTitle,
          section: h.heading,
          category: h.category,
          excerpt: h.excerpt,
        })),
        note:
          searchedDocuments === 0
            ? "No approved documents are available to this requester for this agent."
            : hits.length === 0
              ? "No matching passages were found in the approved documents."
              : undefined,
      },
      logSummary: `Searched ${searchedDocuments} approved document(s); ${hits.length} passage(s) matched.`,
      sources: hits.map((h) => ({
        documentId: h.documentId,
        title: h.documentTitle,
        excerpt: h.excerpt.slice(0, 300),
      })),
    };
  },
};

const onboardingTemplates: AgentTool = {
  key: "onboarding_templates",
  label: "Read onboarding templates",
  description: "Read onboarding workflow templates and their steps.",
  modelUsage:
    'onboarding_templates {"templateId"?: string} — list onboarding templates, or get one template\'s steps. Templates marked placeholder are NOT official procedure.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ templateId: z.string().uuid().optional() }),
  async execute(_ctx, raw) {
    const { templateId } = this.args.parse(raw) as { templateId?: string };
    if (templateId) {
      const { template, steps } = await getTemplate(templateId);
      return {
        data: {
          template: {
            id: template.id,
            name: template.name,
            status: template.status,
            placeholder: template.is_placeholder,
          },
          steps: steps.map((s) => ({
            position: s.position,
            title: s.title,
            responsible: s.responsible_label,
            dueOffsetDays: s.due_offset_days,
            requiredDocument: s.required_document,
            completionRequirement: s.completion_requirement,
          })),
        },
        logSummary: `Read onboarding template "${template.name}".`,
      };
    }
    const templates = (await listTemplates()).filter((t) => t.status !== "archived");
    return {
      data: templates.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        placeholder: t.is_placeholder,
      })),
      logSummary: `Listed ${templates.length} onboarding template(s).`,
    };
  },
};

const onboardingProgress: AgentTool = {
  key: "onboarding_progress",
  label: "Read onboarding progress",
  description:
    "Read active onboarding records: new hire display name, role, start date, and step status.",
  modelUsage:
    'onboarding_progress {"name"?: string} — active onboarding records and progress; optionally filter by new hire name.',
  risk: "read",
  alwaysRequiresApproval: false,
  available: true,
  args: z.object({ name: z.string().trim().max(120).optional() }),
  async execute(_ctx, raw) {
    const { name } = this.args.parse(raw) as { name?: string };
    let instances = await listInstances({ status: "active" });
    if (name) {
      const needle = name.toLowerCase();
      instances = instances.filter((i) => i.employee_display_name.toLowerCase().includes(needle));
    }
    const records = [];
    for (const inst of instances.slice(0, 10)) {
      const { steps } = await getInstance(inst.id);
      const progress = summarizeProgress(steps);
      records.push({
        newHire: inst.employee_display_name,
        role: inst.employee_role,
        startDate: inst.start_date,
        template: inst.template_name,
        progress: `${progress.done} of ${progress.total} steps done (${progress.percent}%)`,
        nextSteps: progress.nextSteps.map((s) => ({
          title: s.title,
          responsible: s.responsible_label,
          due: s.due_date,
        })),
        overdue: progress.overdue.map((s) => ({ title: s.title, due: s.due_date })),
      });
    }
    return {
      data: { activeOnboardings: records, total: instances.length },
      logSummary: `Read ${records.length} active onboarding record(s).`,
      sources: records.length
        ? [{ documentId: null, title: "Onboarding tracker", excerpt: "" }]
        : [],
    };
  },
};

const draftCommunication: AgentTool = {
  key: "draft_communication",
  label: "Draft employee communications",
  description:
    "Write a draft email or message (welcome, reminder, missing-document request). Drafts go to the Approvals queue; nothing is sent.",
  modelUsage:
    'draft_communication {"kind": "welcome"|"instructions"|"reminder"|"document_request"|"follow_up"|"other", "recipientDescription": string, "subject": string, "body": string} — save a draft for human review. Never claim it was sent.',
  risk: "draft",
  alwaysRequiresApproval: true,
  available: true,
  args: z.object({
    kind: z.enum(["welcome", "instructions", "reminder", "document_request", "follow_up", "other"]),
    recipientDescription: z.string().trim().min(1).max(200),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(10_000),
  }),
  async execute(ctx, raw) {
    const args = this.args.parse(raw) as {
      kind: string;
      recipientDescription: string;
      subject: string;
      body: string;
    };
    const approval = await createApproval({
      taskId: ctx.task.id,
      agentId: ctx.agent.row.id,
      actionType: "employee_communication",
      title: `Draft: ${args.subject}`,
      summary: `${args.kind.replace("_", " ")} for ${args.recipientDescription}`,
      payload: { ...args, channel: "email (manual send)" },
      requestedForUserId: ctx.requester.userId,
    });
    return {
      data: { saved: true, approvalId: approval.id, status: "pending human review — not sent" },
      logSummary: `Saved a ${args.kind.replace("_", " ")} draft for review.`,
      approvalId: approval.id,
    };
  },
};

const flagForReview: AgentTool = {
  key: "flag_for_review",
  label: "Flag for human review",
  description:
    "Add an item to the Approvals queue when a question needs a qualified person (legal, sensitive HR).",
  modelUsage:
    'flag_for_review {"reason": string, "summary": string} — ask a qualified human to review a matter. Use for legal determinations and sensitive HR issues.',
  risk: "draft",
  alwaysRequiresApproval: true,
  available: true,
  args: z.object({
    reason: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(2000),
  }),
  async execute(ctx, raw) {
    const args = this.args.parse(raw) as { reason: string; summary: string };
    const approval = await createApproval({
      taskId: ctx.task.id,
      agentId: ctx.agent.row.id,
      actionType: "human_review",
      title: `Review: ${args.reason}`,
      summary: args.summary,
      payload: args,
      requestedForUserId: ctx.requester.userId,
    });
    return {
      data: { flagged: true, approvalId: approval.id },
      logSummary: "Flagged a matter for human review.",
      approvalId: approval.id,
    };
  },
};

function plannedTool(
  key: string,
  label: string,
  description: string,
  risk: ToolRisk,
  reason: string,
): AgentTool {
  return {
    key,
    label,
    description,
    modelUsage: "",
    risk,
    alwaysRequiresApproval: true,
    available: false,
    unavailableReason: reason,
    args: z.unknown(),
    async execute() {
      throw new Error(`${label} is not available yet.`);
    },
  };
}

export const TOOL_REGISTRY: AgentTool[] = [
  ...REPORT_TOOLS,
  ...REPORT_INTEL_TOOLS,
  knowledgeSearch,
  onboardingTemplates,
  onboardingProgress,
  draftCommunication,
  flagForReview,
  plannedTool(
    "send_email",
    "Send email",
    "Send approved communications from a dedicated HR mailbox.",
    "external",
    "Needs a dedicated mailbox, credentials, and an approved sending policy.",
  ),
  plannedTool(
    "bamboohr_read",
    "Read BambooHR",
    "Look up employee records in BambooHR.",
    "read",
    "Needs BambooHR API access and an approved field list.",
  ),
  plannedTool(
    "slack_post",
    "Post in Slack as the agent",
    "Send messages from the agent's own Slack identity.",
    "external",
    "Needs a separate Slack app for the agent and channel policies.",
  ),
];

export const KNOWN_TOOL_KEYS = new Set(TOOL_REGISTRY.filter((t) => t.available).map((t) => t.key));

export function getTool(key: string): AgentTool | null {
  return TOOL_REGISTRY.find((t) => t.key === key) ?? null;
}

export function toolsForAgent(agent: ResolvedAgent): AgentTool[] {
  return agent.config.tools.enabled
    .map(getTool)
    .filter((t): t is AgentTool => Boolean(t && t.available));
}

export function toolRequiresApproval(agent: ResolvedAgent, tool: AgentTool): boolean {
  return tool.alwaysRequiresApproval || agent.config.tools.approvalRequired.includes(tool.key);
}
