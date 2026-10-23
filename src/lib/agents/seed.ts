/**
 * Idempotent bootstrap for the AI organization (Baxter, Sam, Dexter).
 *
 * Only creates what is missing; never overwrites admin edits. Safe to call from any
 * request path — the first call per server instance does the work.
 */

import "server-only";

import {
  BAXTER_AVATAR_PATH,
  BAXTER_DEFAULT_CONFIG,
  BAXTER_DELEGATION_GUIDELINES,
  BAXTER_DELEGATION_GUIDELINES_V1,
  BAXTER_SLUG,
  DEFAULT_DEPARTMENTS,
  DEXTER_AVATAR_PATH,
  DEXTER_DEFAULT_CONFIG,
  DEXTER_LIMITS_V1,
  DEXTER_RESPONSIBILITIES,
  DEXTER_RESPONSIBILITIES_V1,
  DEXTER_RULES_V1,
  DEXTER_TOOLS,
  DEXTER_SLUG,
  PLACEHOLDER_ONBOARDING_TEMPLATE,
  SAM_DEFAULT_CONFIG,
  SAM_SLUG,
} from "./defaults";
import { agentDb, callRpc, eq, isUniqueViolation, selectOne, usesAgentMemoryStore } from "./store";
import {
  agentConfigSchema,
  type AccessLevel,
  type AgentConfig,
  type AgentRow,
  type ConfigVersionRow,
  type DepartmentRow,
} from "./types";

let seedPromise: Promise<void> | null = null;

export function resetSeedForTests(): void {
  seedPromise = null;
}

export function ensureWorkforceSeed(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function insertIgnoringDuplicate(table: string, row: Record<string, unknown>) {
  try {
    await agentDb().insert(table, row);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

async function ensureDepartments(): Promise<Map<string, DepartmentRow>> {
  for (const dept of DEFAULT_DEPARTMENTS) {
    const existing = await selectOne<DepartmentRow>("ai_departments", {
      filters: [eq("slug", dept.slug)],
    });
    if (!existing) await insertIgnoringDuplicate("ai_departments", { ...dept, is_visible: true });
  }
  const rows = await agentDb().select<DepartmentRow>("ai_departments");
  return new Map(rows.map((r) => [r.slug, r]));
}

async function ensureAgent(input: {
  slug: string;
  row: Partial<AgentRow>;
  config: AgentConfig;
  policies: Array<{ principal_type: "role"; principal_value: string; access_level: AccessLevel }>;
}): Promise<AgentRow> {
  const db = agentDb();
  let agent = await selectOne<AgentRow>("ai_agents", { filters: [eq("slug", input.slug)] });
  const isNew = !agent;
  if (!agent) {
    await insertIgnoringDuplicate("ai_agents", { slug: input.slug, ...input.row });
    agent = await selectOne<AgentRow>("ai_agents", { filters: [eq("slug", input.slug)] });
    if (!agent) throw new Error(`Failed to seed agent ${input.slug}`);
  }

  const versions = await db.select<{ id: string }>("ai_agent_config_versions", {
    filters: [eq("agent_id", agent.id)],
    limit: 1,
  });
  if (versions.length === 0) {
    try {
      const [version] = await db.insert<{ id: string }>("ai_agent_config_versions", {
        agent_id: agent.id,
        version_number: 1,
        status: "published",
        config: input.config,
        change_summary: "Initial configuration",
        published_at: new Date().toISOString(),
      });
      if (version) {
        const [updated] = await db.update<AgentRow>("ai_agents", [eq("id", agent.id)], {
          published_version_id: version.id,
        });
        if (updated) agent = updated;
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  // Default policies only on first creation so admins can later remove them.
  if (isNew) {
    for (const p of input.policies) {
      await insertIgnoringDuplicate("ai_agent_access_policies", { agent_id: agent!.id, ...p });
    }
  }

  await insertIgnoringDuplicate("ai_agent_runtime_status", {
    agent_id: agent!.id,
    state: "idle",
    active_task_count: 0,
    updated_at: new Date().toISOString(),
  });
  return agent!;
}

async function ensurePlaceholderOnboardingTemplate() {
  const db = agentDb();
  const any = await db.select<{ id: string }>("ai_onboarding_templates", { limit: 1 });
  if (any.length > 0) return;
  const [template] = await db.insert<{ id: string }>("ai_onboarding_templates", {
    name: PLACEHOLDER_ONBOARDING_TEMPLATE.name,
    description: PLACEHOLDER_ONBOARDING_TEMPLATE.description,
    status: "draft",
    is_placeholder: true,
  });
  if (!template) return;
  await db.insert(
    "ai_onboarding_template_steps",
    PLACEHOLDER_ONBOARDING_TEMPLATE.steps.map((step, index) => ({
      template_id: template.id,
      position: index + 1,
      title: step.title,
      description: null,
      responsible_label: step.responsible_label ?? null,
      due_offset_days: step.due_offset_days ?? 0,
      required_document: "required_document" in step ? step.required_document : null,
      completion_requirement: "completion_requirement" in step ? step.completion_requirement : null,
      depends_on_step_id: null,
      notification_template: "notification_template" in step ? step.notification_template : null,
    })),
  );
}

async function runSeed(): Promise<void> {
  const departments = await ensureDepartments();
  const baxter = await ensureAgent({
    slug: BAXTER_SLUG,
    row: {
      display_name: "Baxter",
      title: "AI CEO",
      description:
        "Acton ADU's primary AI assistant and executive orchestrator. Answers employees directly and delegates specialist work.",
      kind: "orchestrator",
      department_id: departments.get("executive")?.id ?? null,
      manager_agent_id: null,
      status: "active",
      avatar_url: BAXTER_AVATAR_PATH,
      desk: { area: "executive", slot: 0 },
    },
    config: BAXTER_DEFAULT_CONFIG,
    policies: [
      { principal_type: "role", principal_value: "user", access_level: "use_via_baxter" },
      { principal_type: "role", principal_value: "user", access_level: "direct_chat" },
    ],
  });
  await ensureAgent({
    slug: SAM_SLUG,
    row: {
      display_name: "Sam",
      title: "HR, Administration & Legal Specialist",
      description:
        "Handles onboarding, HR administration, SOP-driven processes, employee communication drafts, and HR-related legal reference support. Reports to Baxter.",
      kind: "specialist",
      department_id: departments.get("hr-admin-legal")?.id ?? null,
      manager_agent_id: baxter.id,
      status: "active",
      avatar_url: null,
      desk: { area: "hr-admin-legal", slot: 0 },
    },
    config: SAM_DEFAULT_CONFIG,
    // Restricted by default: admins (implicit) only. Admins grant HR staff access in the Access tab.
    policies: [],
  });
  await ensureAgent({
    slug: DEXTER_SLUG,
    row: {
      display_name: "Dexter",
      title: "AI Reporting & Data Analytics Specialist",
      description:
        "Turns authorized Acton ADU business data — JobTread first — into accurate, interactive reports and dashboards. Reports to Baxter.",
      kind: "specialist",
      department_id: departments.get("business-intelligence")?.id ?? null,
      manager_agent_id: baxter.id,
      status: "active",
      avatar_url: DEXTER_AVATAR_PATH,
      desk: { area: "business-intelligence", slot: 0 },
    },
    config: DEXTER_DEFAULT_CONFIG,
    // Every approved employee can use Reports with project information; customer and
    // financial fields need the extra grants on Dexter's Access tab.
    policies: [
      { principal_type: "role", principal_value: "user", access_level: "use_via_baxter" },
      { principal_type: "role", principal_value: "user", access_level: "direct_chat" },
    ],
  });
  await upgradeBaxterGuidelines(baxter.id);
  const dexter = await selectOne<{ id: string }>("ai_agents", {
    filters: [eq("slug", DEXTER_SLUG)],
  });
  if (dexter) await upgradeDexterConfig(dexter.id);
  await ensurePlaceholderOnboardingTemplate();
}

/**
 * Baxter's shipped delegation guidelines said "handle JobTread yourself", which would steer
 * reporting requests away from Dexter. Publish an updated version only if the live text is
 * still exactly the original default — any admin edit is left alone.
 */
async function upgradeBaxterGuidelines(baxterId: string) {
  const db = agentDb();
  const versions = await db.select<ConfigVersionRow>("ai_agent_config_versions", {
    filters: [eq("agent_id", baxterId)],
  });
  const published = versions.find((v) => v.status === "published");
  if (!published || versions.some((v) => v.status === "draft")) return;
  const parsed = agentConfigSchema.safeParse(published.config);
  if (
    !parsed.success ||
    parsed.data.instructions.delegationGuidelines !== BAXTER_DELEGATION_GUIDELINES_V1
  )
    return;
  const config = {
    ...parsed.data,
    instructions: {
      ...parsed.data.instructions,
      delegationGuidelines: BAXTER_DELEGATION_GUIDELINES,
    },
  };
  const nextVersion = Math.max(...versions.map((v) => v.version_number)) + 1;
  try {
    const [created] = await db.insert<ConfigVersionRow>("ai_agent_config_versions", {
      agent_id: baxterId,
      version_number: nextVersion,
      status: "draft",
      config,
      change_summary: "System: added Dexter to Baxter's delegation guidelines",
      published_by: null,
      published_at: null,
    });
    if (usesAgentMemoryStore()) {
      await db.update("ai_agent_config_versions", [eq("id", published.id)], {
        status: "superseded",
      });
      await db.update("ai_agent_config_versions", [eq("id", created!.id)], {
        status: "published",
        published_at: new Date().toISOString(),
      });
      await db.update("ai_agents", [eq("id", baxterId)], { published_version_id: created!.id });
    } else {
      await callRpc("publish_ai_agent_config", {
        p_agent_id: baxterId,
        p_version_id: created!.id,
        p_published_by: null,
      });
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

const DEXTER_UPGRADE_MARKER = "System: Dexter intelligence upgrade";

/**
 * One-time upgrade of Dexter's published config for the intelligence release: enable the new
 * tools, and replace instructions/limits only where they still equal the shipped V1 defaults.
 * Anything an admin customized in AI Studio is kept.
 */
async function upgradeDexterConfig(dexterId: string) {
  const versions = await agentDb().select<ConfigVersionRow>("ai_agent_config_versions", {
    filters: [eq("agent_id", dexterId)],
  });
  const published = versions.find((v) => v.status === "published");
  if (!published || versions.some((v) => v.status === "draft")) return;
  if (versions.some((v) => (v.change_summary ?? "").startsWith(DEXTER_UPGRADE_MARKER))) return;
  const parsed = agentConfigSchema.safeParse(published.config);
  if (!parsed.success) return;
  const current = parsed.data;
  const enabled = [
    ...new Set([
      ...current.tools.enabled,
      ...DEXTER_TOOLS.filter((t) => !current.tools.enabled.includes(t)),
    ]),
  ];
  const sameLimits =
    JSON.stringify(current.limits) ===
    JSON.stringify(agentConfigSchema.shape.limits.parse(DEXTER_LIMITS_V1));
  const config = {
    ...current,
    instructions: {
      ...current.instructions,
      responsibilities:
        current.instructions.responsibilities === DEXTER_RESPONSIBILITIES_V1
          ? DEXTER_RESPONSIBILITIES
          : current.instructions.responsibilities,
      rules:
        current.instructions.rules === DEXTER_RULES_V1
          ? DEXTER_DEFAULT_CONFIG.instructions.rules
          : current.instructions.rules,
    },
    tools: { ...current.tools, enabled },
    limits: sameLimits ? DEXTER_DEFAULT_CONFIG.limits : current.limits,
    delegation:
      JSON.stringify(current.delegation.keywords) ===
      JSON.stringify(
        DEXTER_DEFAULT_CONFIG.delegation.keywords.filter(
          (k) => !["commission", "commissions", "what data"].includes(k),
        ),
      )
        ? { ...current.delegation, keywords: DEXTER_DEFAULT_CONFIG.delegation.keywords }
        : current.delegation,
  };
  if (JSON.stringify(config) === JSON.stringify(current)) return;
  await publishSystemVersion(
    dexterId,
    versions,
    published,
    config,
    `${DEXTER_UPGRADE_MARKER}: data catalog, feasibility, planning, attachments, and business-rule tools`,
  );
}

async function publishSystemVersion(
  agentId: string,
  versions: ConfigVersionRow[],
  published: ConfigVersionRow,
  config: unknown,
  summary: string,
) {
  const db = agentDb();
  const nextVersion = Math.max(...versions.map((v) => v.version_number)) + 1;
  try {
    const [created] = await db.insert<ConfigVersionRow>("ai_agent_config_versions", {
      agent_id: agentId,
      version_number: nextVersion,
      status: "draft",
      config,
      change_summary: summary,
      published_by: null,
      published_at: null,
    });
    if (usesAgentMemoryStore()) {
      await db.update("ai_agent_config_versions", [eq("id", published.id)], {
        status: "superseded",
      });
      await db.update("ai_agent_config_versions", [eq("id", created!.id)], {
        status: "published",
        published_at: new Date().toISOString(),
      });
      await db.update("ai_agents", [eq("id", agentId)], { published_version_id: created!.id });
    } else {
      await callRpc("publish_ai_agent_config", {
        p_agent_id: agentId,
        p_version_id: created!.id,
        p_published_by: null,
      });
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}
