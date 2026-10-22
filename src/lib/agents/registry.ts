/**
 * Agent registry: loads agents and their validated published configuration.
 *
 * Published config is cached per server instance for a short TTL so the chat hot path
 * does not hit the database on every message. Publishing in this instance clears the
 * cache immediately; other instances pick up changes within CACHE_TTL_MS.
 */

import "server-only";

import { ensureWorkforceSeed } from "./seed";
import { agentDb, eq, selectOne } from "./store";
import {
  agentConfigSchema,
  type AgentRow,
  type ConfigVersionRow,
  type DepartmentRow,
  type ResolvedAgent,
} from "./types";

export const CACHE_TTL_MS = 30_000;

type Cache = { at: number; agents: ResolvedAgent[] } | null;
let cache: Cache = null;

export function invalidateAgentRegistry(): void {
  cache = null;
}

export class AgentConfigInvalidError extends Error {
  constructor(slug: string, detail: string) {
    super(`Agent "${slug}" has an invalid published configuration: ${detail}`);
    this.name = "AgentConfigInvalidError";
  }
}

async function loadAll(): Promise<ResolvedAgent[]> {
  await ensureWorkforceSeed();
  const db = agentDb();
  const [agents, departments, versions] = await Promise.all([
    db.select<AgentRow>("ai_agents", { order: { col: "created_at" } }),
    db.select<DepartmentRow>("ai_departments"),
    db.select<ConfigVersionRow>("ai_agent_config_versions", {
      filters: [eq("status", "published")],
    }),
  ]);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const versionByAgent = new Map(versions.map((v) => [v.agent_id, v]));
  return agents.map((row) => {
    const version = versionByAgent.get(row.id) ?? null;
    const parsed = agentConfigSchema.safeParse(version?.config ?? {});
    return {
      row: { ...row, desk: row.desk ?? {} },
      department: row.department_id ? (deptById.get(row.department_id) ?? null) : null,
      // An unparseable config never executes (see requireExecutableAgent); defaults keep the UI readable.
      config: parsed.success ? parsed.data : agentConfigSchema.parse({}),
      versionId: parsed.success ? (version?.id ?? null) : null,
      versionNumber: parsed.success ? (version?.version_number ?? null) : null,
    };
  });
}

export async function listResolvedAgents(options?: { fresh?: boolean }): Promise<ResolvedAgent[]> {
  if (!options?.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.agents;
  const agents = await loadAll();
  cache = { at: Date.now(), agents };
  return agents;
}

export async function getResolvedAgent(
  slugOrId: string,
  options?: { fresh?: boolean },
): Promise<ResolvedAgent | null> {
  const agents = await listResolvedAgents(options);
  return agents.find((a) => a.row.slug === slugOrId || a.row.id === slugOrId) ?? null;
}

/** Agents Baxter may delegate to: active specialists that accept delegation and have a valid config. */
export async function listDelegationTargets(managerId: string): Promise<ResolvedAgent[]> {
  const agents = await listResolvedAgents();
  return agents.filter(
    (a) =>
      a.row.status === "active" &&
      a.row.kind === "specialist" &&
      a.row.manager_agent_id === managerId &&
      a.versionId !== null &&
      a.config.delegation.acceptsDelegation,
  );
}

export async function getOrchestrator(): Promise<ResolvedAgent | null> {
  const agents = await listResolvedAgents();
  return agents.find((a) => a.row.kind === "orchestrator" && a.row.status === "active") ?? null;
}

export function requireExecutableAgent(agent: ResolvedAgent): void {
  if (agent.row.status !== "active") {
    throw new AgentConfigInvalidError(agent.row.slug, `status is ${agent.row.status}`);
  }
  if (!agent.versionId) {
    throw new AgentConfigInvalidError(agent.row.slug, "no valid published version");
  }
}

export async function getDepartmentRows(): Promise<DepartmentRow[]> {
  await ensureWorkforceSeed();
  return agentDb().select<DepartmentRow>("ai_departments", { order: { col: "sort_order" } });
}

export async function getAgentRowById(id: string): Promise<AgentRow | null> {
  return selectOne<AgentRow>("ai_agents", { filters: [eq("id", id)] });
}
