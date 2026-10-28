/**
 * AI Workforce types: agent configuration contract, task lifecycle, and row shapes.
 *
 * Agent configuration is database-backed (ai_agent_config_versions.config) and
 * validated with these schemas on every save and every load. Anything an admin can
 * edit lives here; protected security rules live in security-policy.ts and are not
 * part of the editable config.
 */

import { z } from "zod";

export const MODEL_PROVIDERS = ["openai", "anthropic"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const EFFORT_LEVELS = ["low", "medium", "high"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const text = (max: number) => z.string().max(max).default("");
const list = (maxItems: number, maxLen = 400) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);

export const instructionsSchema = z.object({
  identity: text(4000),
  tone: text(2000),
  objectives: text(4000),
  responsibilities: text(6000),
  rules: text(6000),
  boundaries: text(4000),
  delegationGuidelines: text(4000),
  escalation: text(3000),
  outputPreferences: text(3000),
});
export type AgentInstructions = z.infer<typeof instructionsSchema>;

export const INSTRUCTION_SECTIONS: Array<{
  key: keyof AgentInstructions;
  label: string;
  help: string;
}> = [
  {
    key: "identity",
    label: "Who this agent is",
    help: "A short description of the agent's role and who it works for.",
  },
  {
    key: "tone",
    label: "Tone and communication style",
    help: "How the agent should sound — e.g. warm, concise, formal.",
  },
  {
    key: "objectives",
    label: "Primary objectives",
    help: "What a great outcome looks like for this agent.",
  },
  {
    key: "responsibilities",
    label: "Responsibilities",
    help: "The work this agent owns. One per line is easiest to read.",
  },
  {
    key: "rules",
    label: "Operating rules",
    help: "Business rules the agent must follow (e.g. 'Always cite the SOP you used').",
  },
  {
    key: "boundaries",
    label: "Scope boundaries",
    help: "What the agent must not do or decide on its own.",
  },
  {
    key: "delegationGuidelines",
    label: "Delegation guidelines",
    help: "For managers: when to hand work to a specialist.",
  },
  {
    key: "escalation",
    label: "Escalation",
    help: "When and how to send something to a human for review.",
  },
  {
    key: "outputPreferences",
    label: "Output preferences",
    help: "Formatting preferences — bullet lists, length, headings.",
  },
];

export const modelConfigSchema = z.object({
  /** environment = keep the deployment's existing env-configured model (Baxter's default). */
  source: z.enum(["environment", "custom"]).default("custom"),
  provider: z.enum(MODEL_PROVIDERS).default("anthropic"),
  model: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[A-Za-z0-9._:-]+$/,
      "Model IDs may only contain letters, numbers, dots, dashes, and colons.",
    )
    .default("claude-opus-5-5"),
  maxOutputTokens: z.number().int().min(512).max(32000).default(4000),
  /** Applied only when the selected model supports a reasoning/effort control. */
  effort: z.enum(EFFORT_LEVELS).nullable().default("low"),
  fallback: z
    .object({
      provider: z.enum(MODEL_PROVIDERS),
      model: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9._:-]+$/),
    })
    .nullable()
    .default(null),
});
export type AgentModelConfig = z.infer<typeof modelConfigSchema>;

export const limitsSchema = z.object({
  maxIterations: z.number().int().min(1).max(16).default(4),
  maxToolCalls: z.number().int().min(0).max(30).default(6),
  // Direct Reports chat runs inside a 300 s route; leave room to save the reply.
  timeoutMs: z.number().int().min(5_000).max(270_000).default(90_000),
  maxTotalTokens: z.number().int().min(2_000).max(800_000).default(80_000),
  maxCostUsd: z.number().min(0.01).max(10).default(1),
});
export type AgentLimits = z.infer<typeof limitsSchema>;

export const delegationSchema = z.object({
  /** Specialists: whether a manager may delegate to this agent. */
  acceptsDelegation: z.boolean().default(false),
  specialization: text(1500),
  supportedTasks: list(30),
  eligibilityCriteria: text(3000),
  positiveExamples: list(40),
  negativeExamples: list(40),
  /** Short phrases that strongly suggest this agent (used to pre-screen before the AI router). */
  keywords: list(60, 80),
  escalationRules: text(2000),
  requiredKnowledgeCategories: list(20, 80),
  /** Results may be posted in public Slack channels (default: DM/web only). */
  allowPublicChannelResults: z.boolean().default(false),
  /** Treat this agent's results as confidential in logs and channels. */
  sensitivity: z.enum(["internal", "confidential"]).default("internal"),
});
export type AgentDelegation = z.infer<typeof delegationSchema>;

export const orchestrationSchema = z.object({
  /** Managers: whether this agent may delegate at all. */
  delegationEnabled: z.boolean().default(false),
  /** hybrid = rules pre-screen then AI router for borderline cases; rules = never call the AI router. */
  routerMode: z.enum(["hybrid", "rules"]).default("hybrid"),
  maxDelegationDepth: z.number().int().min(1).max(2).default(1),
});
export type AgentOrchestration = z.infer<typeof orchestrationSchema>;

export const toolsConfigSchema = z.object({
  enabled: z.array(z.string().min(1).max(80)).max(80).default([]),
  /** Extra tools that need human approval (code-level minimums always apply too). */
  approvalRequired: z.array(z.string().min(1).max(80)).max(80).default([]),
});

export const knowledgeConfigSchema = z.object({
  categories: list(30, 80),
  maxChunksPerQuery: z.number().int().min(1).max(12).default(6),
});

export const agentConfigSchema = z.object({
  instructions: instructionsSchema.default(instructionsSchema.parse({})),
  model: modelConfigSchema.default(modelConfigSchema.parse({})),
  limits: limitsSchema.default(limitsSchema.parse({})),
  delegation: delegationSchema.default(delegationSchema.parse({})),
  orchestration: orchestrationSchema.default(orchestrationSchema.parse({})),
  tools: toolsConfigSchema.default(toolsConfigSchema.parse({})),
  knowledge: knowledgeConfigSchema.default(knowledgeConfigSchema.parse({})),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type AgentStatus = "draft" | "active" | "paused" | "archived";
export type AgentKind = "orchestrator" | "specialist";

export type AgentDesk = { area?: string; slot?: number };

export type AgentRow = {
  id: string;
  slug: string;
  display_name: string;
  title: string;
  description: string;
  kind: AgentKind;
  department_id: string | null;
  manager_agent_id: string | null;
  status: AgentStatus;
  avatar_url: string | null;
  avatar_storage_path: string | null;
  desk: AgentDesk;
  status_label: string | null;
  published_version_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DepartmentRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ConfigVersionStatus = "draft" | "published" | "superseded";

export type ConfigVersionRow = {
  id: string;
  agent_id: string;
  version_number: number;
  status: ConfigVersionStatus;
  config: unknown;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
  published_by: string | null;
  published_at: string | null;
};

export const ACCESS_LEVELS = [
  "use_via_baxter",
  "direct_chat",
  "restricted_data",
  "view_activity",
  "approve",
  "manage",
  // Reports (Dexter): data categories beyond general project information.
  "customer_data",
  "financial_data",
  "business_rules",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, { label: string; help: string }> = {
  use_via_baxter: {
    label: "Ask through Baxter",
    help: "Baxter may hand this person's requests to the agent and share the answer.",
  },
  direct_chat: {
    label: "Chat directly",
    help: "Can open the agent's own chat in the AI Workspace.",
  },
  restricted_data: {
    label: "Restricted documents",
    help: "Answers may draw on documents marked Restricted.",
  },
  view_activity: {
    label: "Review activity",
    help: "Can read the agent's task records and results.",
  },
  approve: {
    label: "Approve actions",
    help: "Can approve or reject the agent's proposed actions and drafts.",
  },
  manage: {
    label: "Manage agent",
    help: "Can edit instructions, knowledge, and settings (includes everything above).",
  },
  customer_data: {
    label: "Customer details (Reports)",
    help: "Reports may show customer-profile fields such as lead source, customer type, and customer story.",
  },
  financial_data: {
    label: "Financial figures (Reports)",
    help: "Reports may show prices, costs, budgets, and margins.",
  },
  business_rules: {
    label: "Edit business rules (Reports)",
    help: "Can set commission rates and assign projects to salespeople in Reports. Changes are audited.",
  },
};

export type PrincipalType = "role" | "user" | "department";

export type AccessPolicyRow = {
  id: string;
  agent_id: string;
  principal_type: PrincipalType;
  principal_value: string;
  access_level: AccessLevel;
  created_by: string | null;
  created_at: string;
};

export const TASK_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export type TaskChannel = "web" | "slack" | "office" | "direct" | "sandbox";

export type TaskRow = {
  id: string;
  idempotency_key: string | null;
  parent_task_id: string | null;
  initiating_user_id: string | null;
  initiating_user_label: string | null;
  channel: TaskChannel;
  conversation_id: string | null;
  assigning_agent_id: string | null;
  assigned_agent_id: string;
  config_version_id: string | null;
  task_type: string;
  title: string;
  instructions: string;
  status: TaskStatus;
  delegation_depth: number;
  attempts: number;
  max_attempts: number;
  lease_expires_at: string | null;
  routing: Record<string, unknown>;
  allowed_context: Record<string, unknown>;
  result: SpecialistResult | null;
  error_code: string | null;
  error_message: string | null;
  approval_state: "none" | "pending" | "approved" | "rejected";
  model_provider: string | null;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  sensitivity: "internal" | "confidential";
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type TaskEventRow = {
  id: string;
  task_id: string;
  event_type: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
};

export const RUNTIME_STATES = [
  "idle",
  "receiving",
  "working",
  "awaiting_result",
  "awaiting_approval",
  "completed",
  "blocked",
  "failed",
] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

export type RuntimeStatusRow = {
  agent_id: string;
  state: RuntimeState;
  active_task_count: number;
  current_task_id: string | null;
  last_completed_at: string | null;
  updated_at: string;
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalRow = {
  id: string;
  task_id: string | null;
  agent_id: string;
  action_type: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  requested_for_user_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Specialist output contract
// ---------------------------------------------------------------------------

export const specialistSourceSchema = z.object({
  documentId: z.string().max(80).nullable().default(null),
  title: z.string().max(300),
  excerpt: z.string().max(600).default(""),
  /** Set by tools (never by the model) for external systems such as BambooHR. */
  provider: z.enum(["bamboohr"]).optional(),
  recordType: z.string().max(80).optional(),
  recordId: z.string().max(40).nullable().optional(),
  retrievedAt: z.string().max(40).optional(),
  freshness: z.enum(["live", "cached", "unavailable"]).optional(),
});

export const specialistResultSchema = z.object({
  outcome: z.enum(["answered", "partial", "missing_information", "needs_review", "declined"]),
  summary: z.string().min(1).max(6000),
  findings: z.array(z.string().max(1500)).max(20).default([]),
  sources: z.array(specialistSourceSchema).max(12).default([]),
  nextSteps: z.array(z.string().max(600)).max(12).default([]),
  proposedActions: z
    .array(
      z.object({
        description: z.string().max(600),
        requiresApproval: z.boolean().default(true),
        approvalId: z.string().max(80).nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
  missingInformation: z.array(z.string().max(600)).max(10).default([]),
  requiresHumanReview: z.boolean().default(false),
  /** Saved outputs (e.g. reports). Filled by the platform from tool results — model-supplied values are discarded. */
  artifacts: z
    .array(
      z.object({
        type: z.literal("report"),
        id: z.string(),
        title: z.string(),
        url: z.string(),
        version: z.number(),
      }),
    )
    .max(5)
    .default([]),
});
export type SpecialistResult = z.infer<typeof specialistResultSchema>;

// ---------------------------------------------------------------------------
// Resolved agent (row + validated published config)
// ---------------------------------------------------------------------------

export type ResolvedAgent = {
  row: AgentRow;
  department: DepartmentRow | null;
  config: AgentConfig;
  versionId: string | null;
  versionNumber: number | null;
};

/** Requester identity after channel-specific verification (web session or mapped Slack user). */
export type Requester = {
  userId: string | null;
  role: string | null;
  departmentId: string | null;
  label: string;
  /** How identity was established; unverified requesters never reach specialists. */
  verifiedVia: "web_session" | "slack_mapping" | "system" | "unverified";
};
