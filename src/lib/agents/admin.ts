/**
 * Admin Studio operations: versioned configuration (draft → publish → rollback),
 * agent identity edits, agent creation, access policies, and workspace settings.
 *
 * Callers (route handlers) must authorize first; every change here is audited.
 */

import "server-only";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit, type AuditActor } from "./audit";
import { invalidateAgentRegistry } from "./registry";
import { validateConfigForPublish } from "./security-policy";
import { agentDb, callRpc, eq, isUniqueViolation, selectOne, usesAgentMemoryStore } from "./store";
import { KNOWN_TOOL_KEYS } from "./tools";
import { diffConfigs } from "./config-diff";

export { diffConfigs, type ConfigChange } from "./config-diff";
import {
  agentConfigSchema,
  type AccessLevel,
  type AccessPolicyRow,
  type AgentConfig,
  type AgentRow,
  type ConfigVersionRow,
  type DepartmentRow,
  type PrincipalType,
} from "./types";

export type ConfigState = {
  published: (ConfigVersionRow & { parsed: AgentConfig }) | null;
  draft: (ConfigVersionRow & { parsed: AgentConfig }) | null;
  history: ConfigVersionRow[];
};

function withParsed(row: ConfigVersionRow | undefined) {
  if (!row) return null;
  const parsed = agentConfigSchema.safeParse(row.config);
  return { ...row, parsed: parsed.success ? parsed.data : agentConfigSchema.parse({}) };
}

export async function getConfigState(agentId: string): Promise<ConfigState> {
  const history = await agentDb().select<ConfigVersionRow>("ai_agent_config_versions", {
    filters: [eq("agent_id", agentId)],
    order: { col: "version_number", ascending: false },
  });
  return {
    published: withParsed(history.find((v) => v.status === "published")),
    draft: withParsed(history.find((v) => v.status === "draft")),
    history,
  };
}

async function nextVersionNumber(agentId: string): Promise<number> {
  const [latest] = await agentDb().select<ConfigVersionRow>("ai_agent_config_versions", {
    filters: [eq("agent_id", agentId)],
    order: { col: "version_number", ascending: false },
    limit: 1,
  });
  return (latest?.version_number ?? 0) + 1;
}

/** Create or replace the single draft. Drafts never affect live behavior. */
export async function saveDraft(input: {
  agentId: string;
  config: unknown;
  changeSummary: string | null;
  actor: AuditActor;
}): Promise<ConfigVersionRow> {
  const parsed = agentConfigSchema.safeParse(input.config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(
      `${issue?.path.join(" › ") || "Configuration"}: ${issue?.message ?? "invalid value"}`,
    );
  }
  const { draft } = await getConfigState(input.agentId);
  let row: ConfigVersionRow | undefined;
  if (draft) {
    [row] = await agentDb().update<ConfigVersionRow>(
      "ai_agent_config_versions",
      [eq("id", draft.id), eq("status", "draft")],
      { config: parsed.data, change_summary: input.changeSummary, created_by: input.actor.userId },
    );
  } else {
    try {
      [row] = await agentDb().insert<ConfigVersionRow>("ai_agent_config_versions", {
        agent_id: input.agentId,
        version_number: await nextVersionNumber(input.agentId),
        status: "draft",
        config: parsed.data,
        change_summary: input.changeSummary,
        created_by: input.actor.userId,
        published_by: null,
        published_at: null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ValidationError("Someone else just saved a draft. Reload and try again.");
      }
      throw error;
    }
  }
  if (!row)
    throw new ValidationError("The draft changed while you were editing. Reload and try again.");
  await recordAudit({
    actor: input.actor,
    action: "config.draft_saved",
    targetType: "agent",
    targetId: input.agentId,
    summary: `Saved draft v${row.version_number}${input.changeSummary ? `: ${input.changeSummary}` : ""}.`,
  });
  return row;
}

export async function discardDraft(agentId: string, actor: AuditActor): Promise<void> {
  const removed = await agentDb().remove("ai_agent_config_versions", [
    eq("agent_id", agentId),
    eq("status", "draft"),
  ]);
  if (removed) {
    await recordAudit({
      actor,
      action: "config.draft_discarded",
      targetType: "agent",
      targetId: agentId,
      summary: "Discarded draft.",
    });
  }
}

export function publishProblems(agent: AgentRow, config: AgentConfig): string[] {
  return validateConfigForPublish(config, { kind: agent.kind, knownTools: KNOWN_TOOL_KEYS });
}

export async function publishDraft(agentId: string, actor: AuditActor): Promise<ConfigVersionRow> {
  const agent = await selectOne<AgentRow>("ai_agents", { filters: [eq("id", agentId)] });
  if (!agent) throw new NotFoundError("Agent not found");
  const { draft, published } = await getConfigState(agentId);
  if (!draft) throw new ValidationError("There is no draft to publish.");
  const problems = publishProblems(agent, draft.parsed);
  if (problems.length)
    throw new ValidationError(`Fix these before publishing: ${problems.join(" ")}`);

  if (usesAgentMemoryStore()) {
    if (published) {
      await agentDb().update("ai_agent_config_versions", [eq("id", published.id)], {
        status: "superseded",
      });
    }
    await agentDb().update("ai_agent_config_versions", [eq("id", draft.id)], {
      status: "published",
      published_by: actor.userId,
      published_at: new Date().toISOString(),
    });
    await agentDb().update("ai_agents", [eq("id", agentId)], { published_version_id: draft.id });
  } else {
    await callRpc("publish_ai_agent_config", {
      p_agent_id: agentId,
      p_version_id: draft.id,
      p_published_by: actor.userId,
    });
  }
  invalidateAgentRegistry();
  await recordAudit({
    actor,
    action: "config.published",
    targetType: "agent",
    targetId: agentId,
    summary: `Published v${draft.version_number}${published ? ` (replacing v${published.version_number})` : ""}.`,
    details: {
      versionId: draft.id,
      changes: published ? diffConfigs(published.parsed, draft.parsed).map((c) => c.path) : [],
    },
  });
  return { ...draft, status: "published" };
}

/** Restore an earlier version: copies it into a new version and publishes it. */
export async function restoreVersion(agentId: string, versionId: string, actor: AuditActor) {
  const version = await selectOne<ConfigVersionRow>("ai_agent_config_versions", {
    filters: [eq("id", versionId), eq("agent_id", agentId)],
  });
  if (!version) throw new NotFoundError("Version not found");
  await discardDraft(agentId, actor);
  await saveDraft({
    agentId,
    config: version.config,
    changeSummary: `Restored from v${version.version_number}`,
    actor,
  });
  const published = await publishDraft(agentId, actor);
  await recordAudit({
    actor,
    action: "config.restored",
    targetType: "agent",
    targetId: agentId,
    summary: `Restored configuration from v${version.version_number} as v${published.version_number}.`,
  });
  return published;
}

// ---------------------------------------------------------------------------
// Agent identity + creation
// ---------------------------------------------------------------------------

export type AgentIdentityPatch = Partial<
  Pick<
    AgentRow,
    | "display_name"
    | "title"
    | "description"
    | "department_id"
    | "manager_agent_id"
    | "status"
    | "status_label"
    | "desk"
  >
>;

export async function updateAgentIdentity(
  agentId: string,
  patch: AgentIdentityPatch,
  actor: AuditActor,
) {
  const agent = await selectOne<AgentRow>("ai_agents", { filters: [eq("id", agentId)] });
  if (!agent) throw new NotFoundError("Agent not found");
  if (agent.kind === "orchestrator" && patch.status && patch.status !== "active") {
    throw new ValidationError(
      "Baxter is the primary assistant and cannot be paused or archived here.",
    );
  }
  if (patch.manager_agent_id !== undefined && patch.manager_agent_id !== null) {
    if (patch.manager_agent_id === agentId)
      throw new ValidationError("An agent cannot report to itself.");
    // Walk up the chain to block cycles (the database trigger enforces this too).
    let cursor: string | null = patch.manager_agent_id;
    for (let depth = 0; cursor && depth < 32; depth++) {
      if (cursor === agentId) throw new ValidationError("That reporting line would create a loop.");
      const next: AgentRow | null = await selectOne<AgentRow>("ai_agents", {
        filters: [eq("id", cursor)],
      });
      cursor = next?.manager_agent_id ?? null;
    }
  }
  const [updated] = await agentDb().update<AgentRow>("ai_agents", [eq("id", agentId)], patch);
  invalidateAgentRegistry();
  await recordAudit({
    actor,
    action: "agent.updated",
    targetType: "agent",
    targetId: agentId,
    summary: `Updated ${Object.keys(patch).join(", ")} for ${agent.display_name}.`,
  });
  return updated!;
}

export async function setAgentAvatar(
  agentId: string,
  avatar: { url: string | null; storagePath: string | null },
  actor: AuditActor,
) {
  await agentDb().update("ai_agents", [eq("id", agentId)], {
    avatar_url: avatar.url,
    avatar_storage_path: avatar.storagePath,
  });
  invalidateAgentRegistry();
  await recordAudit({
    actor,
    action: "agent.avatar_changed",
    targetType: "agent",
    targetId: agentId,
    summary: avatar.url ? "Changed portrait." : "Reset portrait to default.",
  });
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function createAgent(input: {
  displayName: string;
  title: string;
  description: string;
  departmentId: string | null;
  managerAgentId: string | null;
  config: unknown;
  activate: boolean;
  actor: AuditActor;
}): Promise<AgentRow> {
  const config = agentConfigSchema.parse(input.config);
  const base = slugify(input.displayName) || "agent";
  let slug = base;
  for (let i = 2; await selectOne("ai_agents", { filters: [eq("slug", slug)] }); i++)
    slug = `${base}-${i}`;
  const [agent] = await agentDb().insert<AgentRow>("ai_agents", {
    slug,
    display_name: input.displayName,
    title: input.title,
    description: input.description,
    kind: "specialist",
    department_id: input.departmentId,
    manager_agent_id: input.managerAgentId,
    status: "draft",
    avatar_url: null,
    avatar_storage_path: null,
    desk: { area: input.departmentId ?? "future" },
    status_label: null,
    published_version_id: null,
    created_by: input.actor.userId,
  });
  await agentDb().insert("ai_agent_runtime_status", {
    agent_id: agent!.id,
    state: "idle",
    active_task_count: 0,
    updated_at: new Date().toISOString(),
  });
  await saveDraft({
    agentId: agent!.id,
    config,
    changeSummary: "Created with the agent wizard",
    actor: input.actor,
  });
  if (input.activate) {
    await publishDraft(agent!.id, input.actor);
    await agentDb().update("ai_agents", [eq("id", agent!.id)], { status: "active" });
  }
  invalidateAgentRegistry();
  await recordAudit({
    actor: input.actor,
    action: "agent.created",
    targetType: "agent",
    targetId: agent!.id,
    summary: `Created agent ${input.displayName}${input.activate ? " (active)" : " (draft)"}.`,
  });
  return (await selectOne<AgentRow>("ai_agents", { filters: [eq("id", agent!.id)] }))!;
}

// ---------------------------------------------------------------------------
// Access policies
// ---------------------------------------------------------------------------

export async function addAccessPolicy(input: {
  agentId: string;
  principalType: PrincipalType;
  principalValue: string;
  accessLevel: AccessLevel;
  actor: AuditActor;
}): Promise<void> {
  try {
    await agentDb().insert("ai_agent_access_policies", {
      agent_id: input.agentId,
      principal_type: input.principalType,
      principal_value: input.principalValue,
      access_level: input.accessLevel,
      created_by: input.actor.userId,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return;
  }
  await recordAudit({
    actor: input.actor,
    action: "permission.granted",
    targetType: "agent",
    targetId: input.agentId,
    summary: `Granted "${input.accessLevel}" to ${input.principalType} ${input.principalValue}.`,
  });
}

export async function removeAccessPolicy(policyId: string, actor: AuditActor): Promise<void> {
  const policy = await selectOne<AccessPolicyRow>("ai_agent_access_policies", {
    filters: [eq("id", policyId)],
  });
  if (!policy) return;
  await agentDb().remove("ai_agent_access_policies", [eq("id", policyId)]);
  await recordAudit({
    actor,
    action: "permission.revoked",
    targetType: "agent",
    targetId: policy.agent_id,
    summary: `Removed "${policy.access_level}" from ${policy.principal_type} ${policy.principal_value}.`,
  });
}

// ---------------------------------------------------------------------------
// Departments + workspace settings
// ---------------------------------------------------------------------------

export type WorkspaceSettings = {
  id: "default";
  layout_preset: "studio" | "campus" | "compact";
  theme: "daylight" | "evening" | "blueprint";
  show_meeting_area: boolean;
  show_future_space: boolean;
  area_labels: Record<string, string>;
  updated_by: string | null;
  updated_at: string;
};

const DEFAULT_SETTINGS: WorkspaceSettings = {
  id: "default",
  layout_preset: "studio",
  theme: "daylight",
  show_meeting_area: true,
  show_future_space: true,
  area_labels: {},
  updated_by: null,
  updated_at: new Date(0).toISOString(),
};

export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  const row = await selectOne<WorkspaceSettings>("ai_workspace_settings", {
    filters: [eq("id", "default")],
  });
  return { ...DEFAULT_SETTINGS, ...(row ?? {}), area_labels: row?.area_labels ?? {} };
}

export async function updateWorkspaceSettings(
  patch: Partial<WorkspaceSettings>,
  actor: AuditActor,
) {
  const current = await getWorkspaceSettings();
  const next = {
    ...current,
    ...patch,
    id: "default" as const,
    updated_by: actor.userId,
    updated_at: new Date().toISOString(),
  };
  await agentDb().upsert("ai_workspace_settings", next, ["id"]);
  await recordAudit({
    actor,
    action: "workspace.updated",
    targetType: "workspace",
    targetId: "default",
    summary: `Updated ${Object.keys(patch).join(", ")}.`,
  });
  return next;
}

export async function upsertDepartment(
  input: {
    id?: string;
    name: string;
    description: string | null;
    color: string;
    is_visible: boolean;
  },
  actor: AuditActor,
): Promise<DepartmentRow> {
  if (input.id) {
    const [row] = await agentDb().update<DepartmentRow>("ai_departments", [eq("id", input.id)], {
      name: input.name,
      description: input.description,
      color: input.color,
      is_visible: input.is_visible,
    });
    if (!row) throw new NotFoundError("Department not found");
    invalidateAgentRegistry();
    await recordAudit({
      actor,
      action: "department.updated",
      targetType: "department",
      targetId: row.id,
      summary: `Updated department ${row.name}.`,
    });
    return row;
  }
  const base = slugify(input.name) || "department";
  let slug = base;
  for (let i = 2; await selectOne("ai_departments", { filters: [eq("slug", slug)] }); i++)
    slug = `${base}-${i}`;
  const existing = await agentDb().select<DepartmentRow>("ai_departments");
  const [row] = await agentDb().insert<DepartmentRow>("ai_departments", {
    slug,
    name: input.name,
    description: input.description,
    color: input.color,
    is_visible: input.is_visible,
    sort_order: (existing.length + 1) * 10,
  });
  invalidateAgentRegistry();
  await recordAudit({
    actor,
    action: "department.created",
    targetType: "department",
    targetId: row!.id,
    summary: `Created department ${row!.name}.`,
  });
  return row!;
}
