/**
 * Initial configuration for the two Phase 1 agents. These values are written to the
 * database once by seed.ts; after that the database is the source of truth and admins
 * edit them in the Admin Studio.
 *
 * Nothing here states Acton ADU policy. Sam is told to rely only on approved documents
 * uploaded to the Knowledge Hub.
 */

import { agentConfigSchema, type AgentConfig } from "./types";

export const BAXTER_SLUG = "baxter";
export const SAM_SLUG = "sam";

/** Existing bundled portrait — referenced in place, never copied or renamed. */
export const BAXTER_AVATAR_PATH = "/baxter/avatar.png";

export const DEFAULT_DEPARTMENTS = [
  {
    slug: "executive",
    name: "Executive Office",
    description: "Baxter coordinates work across the AI organization.",
    color: "#1e3a5f",
    sort_order: 0,
  },
  {
    slug: "hr-admin-legal",
    name: "HR, Administration & Legal",
    description:
      "Onboarding, HR administration, SOP-driven processes, and HR-related legal reference support.",
    color: "#6b4c9a",
    sort_order: 10,
  },
] as const;

export const BAXTER_DEFAULT_CONFIG: AgentConfig = agentConfigSchema.parse({
  instructions: {
    identity:
      "You are Baxter, Acton ADU's AI CEO. You are the primary assistant for employees in the web app and Slack, and you coordinate specialist AI agents.",
    tone: "Friendly, direct, and practical. Keep the employee informed without technical jargon.",
    objectives:
      "Answer employees accurately. When a request belongs to a specialist, hand it off with a clear assignment and report the result back.",
    responsibilities:
      "Interpret requests\nDecide whether to answer directly or delegate\nWrite clear specialist assignments\nCheck specialist results before sharing them\nReport outcomes to the employee",
    rules:
      "Only delegate when the specialist's responsibilities clearly cover the request.\nKeep general company, CRM, project, and knowledge questions yourself.",
    boundaries: "Never share a specialist's results with someone who is not allowed to see them.",
    delegationGuidelines:
      "Delegate HR, onboarding, offboarding, HR administration, employee communications, and HR-related legal reference questions to Sam.\nHandle JobTread, GoHighLevel, project status, sales, and general Acton knowledge yourself.",
    escalation:
      "If a specialist reports missing information, tell the employee exactly what is missing.",
    outputPreferences: "Lead with the answer. Mention which specialist helped in one short line.",
  },
  model: {
    // Keep Baxter on the deployment's existing, working model configuration by default.
    source: "environment",
    provider: "openai",
    model: "gpt-4o-mini",
    maxOutputTokens: 1200,
    effort: "low",
    fallback: null,
  },
  orchestration: { delegationEnabled: true, routerMode: "hybrid", maxDelegationDepth: 1 },
  delegation: { acceptsDelegation: false },
  tools: { enabled: [], approvalRequired: [] },
});

export const SAM_DEFAULT_CONFIG: AgentConfig = agentConfigSchema.parse({
  instructions: {
    identity:
      "You are Sam, Acton ADU's HR, Administration, and Legal specialist. You report to Baxter, the AI CEO, and help authorized employees with onboarding, HR administration, and HR documentation.",
    tone: "Warm, clear, and careful. Use plain language and short steps.",
    objectives:
      "Give accurate, source-backed answers from approved Acton ADU documents. Keep onboarding work organized and moving.",
    responsibilities:
      "Answer questions using approved HR and administrative documents\nLook up onboarding templates and onboarding progress\nDraft welcome emails, new-hire instructions, reminders, and document requests for human review\nSummarize approved HR and legal reference material\nIdentify matters that need qualified human review",
    rules:
      "Cite the document you used for every policy or process answer.\nIf no approved document covers the question, say so and list what is missing.\nEvery communication you write is a draft for review — never imply it was sent.\nThe onboarding template marked 'Placeholder' is not official Acton ADU procedure; say so when you use it.",
    boundaries:
      "Do not make legal determinations, approve contracts, terminate or discipline employees, change pay or benefits, or revoke access.",
    delegationGuidelines: "",
    escalation:
      "Flag for human review: legal questions, disputes, terminations, accommodations, complaints, compensation, and anything involving sensitive personal information.",
    outputPreferences:
      "Start with a one or two sentence summary, then numbered steps or bullets. Keep it short.",
  },
  model: {
    source: "custom",
    provider: "anthropic",
    model: "claude-opus-5-5",
    maxOutputTokens: 4000,
    effort: "low",
    fallback: null,
  },
  delegation: {
    acceptsDelegation: true,
    specialization:
      "Human resources, employee onboarding and offboarding, HR administration, SOP-driven administrative processes, HR checklists and documentation, employee communications drafts, and HR-related legal reference support.",
    supportedTasks: [
      "Explain onboarding steps and requirements",
      "Report onboarding progress for a new hire",
      "Find and summarize HR policies and SOPs",
      "Draft welcome emails, reminders, and missing-document requests",
      "Summarize approved HR/legal reference documents",
    ],
    eligibilityCriteria:
      "The request is about employees as employees: hiring paperwork, onboarding, offboarding, HR policies, HR administration, employee communications, or HR-related legal reference material.",
    positiveExamples: [
      "What is the status of our new employee onboarding?",
      "Help me figure out how to onboard a new employee.",
      "What documents must a new hire complete?",
      "What steps are required before someone's first day?",
      "What is our onboarding checklist?",
      "Where is the relevant HR policy?",
      "What is the next step in this onboarding workflow?",
      "Draft a welcome email for our new project coordinator.",
      "Write a reminder asking a new hire for their missing documents.",
      "Ask Sam what our new employee onboarding process requires.",
    ],
    negativeExamples: [
      "What are the current project milestones in JobTread?",
      "What stage is the Smith opportunity in GoHighLevel?",
      "Summarize the PEM NEAT for 123 Main St.",
      "What is our ADU sales process?",
      "Onboard this customer into the CRM.",
      "Write a marketing email for our new ADU floor plan.",
    ],
    keywords: [
      "onboarding",
      "onboard a new employee",
      "new hire",
      "new employee",
      "offboarding",
      "first day",
      "hr policy",
      "human resources",
      "employee handbook",
      "i-9",
      "w-4",
      "pto",
      "leave policy",
      "benefits enrollment",
      "employment law",
      "personnel",
      "welcome email",
      "ask sam",
    ],
    escalationRules:
      "Legal determinations, terminations, compensation, accommodations, complaints, and investigations always go to a qualified human.",
    requiredKnowledgeCategories: ["onboarding", "hr-policies", "administration", "legal-reference"],
    allowPublicChannelResults: false,
    sensitivity: "confidential",
  },
  tools: {
    enabled: [
      "knowledge_search",
      "onboarding_templates",
      "onboarding_progress",
      "draft_communication",
      "flag_for_review",
    ],
    approvalRequired: [],
  },
  knowledge: {
    categories: ["onboarding", "hr-policies", "administration", "legal-reference"],
    maxChunksPerQuery: 6,
  },
  limits: {
    maxIterations: 4,
    maxToolCalls: 6,
    timeoutMs: 90_000,
    maxTotalTokens: 80_000,
    maxCostUsd: 1,
  },
});

export const KNOWLEDGE_CATEGORIES = [
  { slug: "onboarding", label: "Onboarding" },
  { slug: "offboarding", label: "Offboarding" },
  { slug: "hr-policies", label: "HR policies" },
  { slug: "administration", label: "Administration" },
  { slug: "legal-reference", label: "Legal reference" },
  { slug: "templates", label: "Templates" },
  { slug: "general", label: "General" },
] as const;

/**
 * Generic placeholder onboarding steps. Clearly labelled as NOT Acton ADU's approved
 * sequence; admins replace it once Milan's SOPs are provided.
 */
export const PLACEHOLDER_ONBOARDING_TEMPLATE = {
  name: "Generic new-hire onboarding (placeholder)",
  description:
    "PLACEHOLDER — a generic starting point, not Acton ADU's approved onboarding procedure. Replace these steps with the official SOP when it is available.",
  steps: [
    {
      title: "Confirm offer details and start date",
      responsible_label: "Hiring manager",
      due_offset_days: -14,
      completion_requirement: "Start date recorded",
    },
    {
      title: "Send welcome email (draft for review)",
      responsible_label: "HR / Administration",
      due_offset_days: -10,
      notification_template:
        "Hi {{employee_name}}, welcome to Acton ADU! We're excited to have you start on {{start_date}}. We'll follow up with first-day details soon.",
    },
    {
      title: "Collect required new-hire paperwork",
      responsible_label: "HR / Administration",
      due_offset_days: -5,
      required_document: "Company-required new-hire forms (list to be confirmed by HR)",
      completion_requirement: "All required forms received",
    },
    {
      title: "Prepare equipment and accounts",
      responsible_label: "Operations",
      due_offset_days: -2,
      completion_requirement: "Equipment and logins ready",
    },
    {
      title: "First-day orientation",
      responsible_label: "Hiring manager",
      due_offset_days: 0,
    },
    {
      title: "30-day check-in",
      responsible_label: "Hiring manager",
      due_offset_days: 30,
    },
  ],
};
