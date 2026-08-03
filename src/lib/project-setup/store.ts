import "server-only";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import {
  DEFAULT_CHARTER_LIST_TAB_NAME,
  DEFAULT_MASTER_CHARTER_SPREADSHEET_ID,
  DEFAULT_MASTER_LOG_TAB_NAME,
  DEFAULT_PROJECTS_PARENT_FOLDER_ID,
  DEFAULT_STANDING_MEMBER_EMAILS,
  DEFAULT_TEMPLATE_FOLDER_ID,
  DEFAULT_TEST_MEMBER_EMAILS,
  type ProjectSetupContactSnapshot,
  type ProjectSetupRun,
  type ProjectSetupRunStatus,
  type ProjectSetupSettings,
  type ProjectSetupStep,
  type ProjectSetupStepKey,
  type ProjectSetupStepStatus,
  PROJECT_SETUP_STEP_KEYS,
} from "./types";
import { normalizeEmailList } from "./names";

type SettingsRow = {
  id: number;
  member_emails: unknown;
  test_mode: boolean;
  test_member_emails: unknown;
  template_folder_id: string;
  projects_parent_folder_id: string;
  master_charter_spreadsheet_id: string;
  master_log_tab_name: string;
  charter_list_tab_name?: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

type RunRow = {
  id: string;
  status: ProjectSetupRunStatus;
  dry_run: boolean;
  initiated_by: string | null;
  trigger_channel: "web" | "slack";
  slack_initiator_id?: string | null;
  ghl_contact_id: string | null;
  contact_snapshot_json: ProjectSetupContactSnapshot | Record<string, unknown>;
  sales_rep: string | null;
  project_number: string | null;
  project_last_name: string | null;
  folder_name: string | null;
  charter_name: string | null;
  slack_channel_name: string | null;
  fp_paid_date: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type StepRow = {
  id: string;
  run_id: string;
  step_key: string;
  order_index: number;
  status: ProjectSetupStepStatus;
  output_json: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryState = {
  settings: ProjectSetupSettings;
  runs: Map<string, ProjectSetupRun>;
  steps: Map<string, ProjectSetupStep[]>;
  /** Run-level execution leases (defense in depth vs job reclaim races). */
  executionLocks: Map<string, { token: string; lockedAt: string }>;
};

const globalMemory = globalThis as typeof globalThis & {
  __actonProjectSetupMemory?: MemoryState;
};

function usesMemoryStore(env = getEnv()): boolean {
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    (env.ENABLE_MOCK_RESEARCH && env.NODE_ENV !== "production") ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

function defaultSettings(): ProjectSetupSettings {
  const now = new Date().toISOString();
  return {
    id: 1,
    memberEmails: [...DEFAULT_STANDING_MEMBER_EMAILS],
    testMode: true,
    testMemberEmails: [...DEFAULT_TEST_MEMBER_EMAILS],
    templateFolderId: DEFAULT_TEMPLATE_FOLDER_ID,
    projectsParentFolderId: DEFAULT_PROJECTS_PARENT_FOLDER_ID,
    masterCharterSpreadsheetId: DEFAULT_MASTER_CHARTER_SPREADSHEET_ID,
    masterLogTabName: DEFAULT_MASTER_LOG_TAB_NAME,
    charterListTabName: DEFAULT_CHARTER_LIST_TAB_NAME,
    updatedBy: null,
    updatedAt: now,
    createdAt: now,
  };
}

function getMemory(): MemoryState {
  if (!globalMemory.__actonProjectSetupMemory) {
    globalMemory.__actonProjectSetupMemory = {
      settings: defaultSettings(),
      runs: new Map(),
      steps: new Map(),
      executionLocks: new Map(),
    };
  }
  if (!globalMemory.__actonProjectSetupMemory.executionLocks) {
    globalMemory.__actonProjectSetupMemory.executionLocks = new Map();
  }
  return globalMemory.__actonProjectSetupMemory;
}

export function resetProjectSetupMemoryForTests(): void {
  globalMemory.__actonProjectSetupMemory = {
    settings: defaultSettings(),
    runs: new Map(),
    steps: new Map(),
    executionLocks: new Map(),
  };
}

function mapSettings(row: SettingsRow): ProjectSetupSettings {
  return {
    id: 1,
    memberEmails: normalizeEmailList(row.member_emails),
    testMode: Boolean(row.test_mode),
    testMemberEmails: normalizeEmailList(row.test_member_emails),
    templateFolderId: row.template_folder_id,
    projectsParentFolderId: row.projects_parent_folder_id,
    masterCharterSpreadsheetId: row.master_charter_spreadsheet_id,
    masterLogTabName: row.master_log_tab_name || DEFAULT_MASTER_LOG_TAB_NAME,
    charterListTabName: row.charter_list_tab_name?.trim() || DEFAULT_CHARTER_LIST_TAB_NAME,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function mapRun(row: RunRow): ProjectSetupRun {
  const snap = (row.contact_snapshot_json ?? {}) as ProjectSetupContactSnapshot;
  return {
    id: row.id,
    status: row.status,
    dryRun: Boolean(row.dry_run),
    initiatedBy: row.initiated_by,
    triggerChannel: row.trigger_channel,
    slackInitiatorId: row.slack_initiator_id ?? null,
    ghlContactId: row.ghl_contact_id,
    contactSnapshot: {
      id: snap.id ?? row.ghl_contact_id ?? "",
      name: snap.name ?? null,
      firstName: snap.firstName ?? null,
      lastName: snap.lastName ?? null,
      email: snap.email ?? null,
      phone: snap.phone ?? null,
      address: snap.address ?? null,
      city: snap.city ?? null,
      state: snap.state ?? null,
      postalCode: snap.postalCode ?? null,
      assignedUserId: snap.assignedUserId ?? null,
      assignedUserName: snap.assignedUserName ?? null,
    },
    salesRep: row.sales_rep,
    projectNumber: row.project_number,
    projectLastName: row.project_last_name,
    folderName: row.folder_name,
    charterName: row.charter_name,
    slackChannelName: row.slack_channel_name,
    fpPaidDate: row.fp_paid_date,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStep(row: StepRow): ProjectSetupStep {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key as ProjectSetupStepKey,
    orderIndex: row.order_index,
    status: row.status,
    outputJson: row.output_json ?? {},
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProjectSetupSettings(): Promise<ProjectSetupSettings> {
  if (usesMemoryStore()) return { ...getMemory().settings };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("project_setup_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const seeded = defaultSettings();
    await supabase.from("project_setup_settings").upsert({
      id: 1,
      member_emails: seeded.memberEmails,
      test_mode: seeded.testMode,
      test_member_emails: seeded.testMemberEmails,
      template_folder_id: seeded.templateFolderId,
      projects_parent_folder_id: seeded.projectsParentFolderId,
      master_charter_spreadsheet_id: seeded.masterCharterSpreadsheetId,
      master_log_tab_name: seeded.masterLogTabName,
      charter_list_tab_name: seeded.charterListTabName,
    });
    return seeded;
  }
  return mapSettings(data as SettingsRow);
}

export async function updateProjectSetupSettings(
  patch: Partial<{
    memberEmails: string[];
    testMode: boolean;
    testMemberEmails: string[];
    templateFolderId: string;
    projectsParentFolderId: string;
    masterCharterSpreadsheetId: string;
    masterLogTabName: string;
    charterListTabName: string;
  }>,
  updatedBy: string | null,
): Promise<ProjectSetupSettings> {
  const current = await getProjectSetupSettings();
  const next: ProjectSetupSettings = {
    ...current,
    memberEmails: patch.memberEmails
      ? normalizeEmailList(patch.memberEmails)
      : current.memberEmails,
    testMode: patch.testMode ?? current.testMode,
    testMemberEmails: patch.testMemberEmails
      ? normalizeEmailList(patch.testMemberEmails)
      : current.testMemberEmails,
    templateFolderId: patch.templateFolderId?.trim() || current.templateFolderId,
    projectsParentFolderId: patch.projectsParentFolderId?.trim() || current.projectsParentFolderId,
    masterCharterSpreadsheetId:
      patch.masterCharterSpreadsheetId?.trim() || current.masterCharterSpreadsheetId,
    masterLogTabName: patch.masterLogTabName?.trim() || current.masterLogTabName,
    charterListTabName: patch.charterListTabName?.trim() || current.charterListTabName,
    updatedBy,
    updatedAt: new Date().toISOString(),
  };

  if (usesMemoryStore()) {
    getMemory().settings = next;
    return next;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("project_setup_settings")
    .upsert({
      id: 1,
      member_emails: next.memberEmails,
      test_mode: next.testMode,
      test_member_emails: next.testMemberEmails,
      template_folder_id: next.templateFolderId,
      projects_parent_folder_id: next.projectsParentFolderId,
      master_charter_spreadsheet_id: next.masterCharterSpreadsheetId,
      master_log_tab_name: next.masterLogTabName,
      charter_list_tab_name: next.charterListTabName,
      updated_by: updatedBy,
      updated_at: next.updatedAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapSettings(data as SettingsRow);
}

/**
 * True when a LIVE (non-dry-run) run in a non-failed/non-cancelled status holds this number.
 * Dry-run recorded numbers are informational only and never reserve.
 */
export async function isProjectNumberInUse(
  projectNumber: string,
  excludeRunId?: string,
): Promise<boolean> {
  const normalized = projectNumber.trim().toUpperCase();
  if (usesMemoryStore()) {
    for (const run of getMemory().runs.values()) {
      if (excludeRunId && run.id === excludeRunId) continue;
      if (run.dryRun) continue;
      if (
        run.projectNumber?.toUpperCase() === normalized &&
        run.status !== "failed" &&
        run.status !== "cancelled"
      ) {
        return true;
      }
    }
    return false;
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("project_setup_runs")
    .select("id")
    .eq("project_number", normalized)
    .eq("dry_run", false)
    .not("status", "in", "(failed,cancelled)")
    .limit(1);
  if (excludeRunId) query = query.neq("id", excludeRunId);
  const { data, error } = await query;
  if (error) throw error;
  return Boolean(data?.length);
}

export async function createProjectSetupRun(input: {
  initiatedBy: string;
  triggerChannel?: "web" | "slack";
  slackInitiatorId?: string | null;
  dryRun?: boolean;
  ghlContactId: string;
  contactSnapshot: ProjectSetupContactSnapshot;
  salesRep: string;
  projectNumber: string;
  projectLastName: string;
  folderName: string;
  charterName: string;
  slackChannelName: string;
  fpPaidDate: string;
}): Promise<{ run: ProjectSetupRun; steps: ProjectSetupStep[] }> {
  const projectNumber = input.projectNumber.trim().toUpperCase();
  const dryRun = input.dryRun ?? true;
  // Only live runs reserve numbers — dry runs skip uniqueness against other dry runs.
  if (!dryRun && (await isProjectNumberInUse(projectNumber))) {
    throw new Error(
      `Project number ${projectNumber} is already in use by another active setup run.`,
    );
  }

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const run: ProjectSetupRun = {
    id: runId,
    status: "confirmed",
    dryRun,
    initiatedBy: input.initiatedBy,
    triggerChannel: input.triggerChannel ?? "web",
    slackInitiatorId: input.slackInitiatorId ?? null,
    ghlContactId: input.ghlContactId,
    contactSnapshot: input.contactSnapshot,
    salesRep: input.salesRep,
    projectNumber,
    projectLastName: input.projectLastName,
    folderName: input.folderName,
    charterName: input.charterName,
    slackChannelName: input.slackChannelName,
    fpPaidDate: input.fpPaidDate,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const steps: ProjectSetupStep[] = PROJECT_SETUP_STEP_KEYS.map((key, index) => ({
    id: crypto.randomUUID(),
    runId,
    stepKey: key,
    orderIndex: index,
    status: "pending" as const,
    outputJson: {},
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  }));

  if (usesMemoryStore()) {
    getMemory().runs.set(runId, run);
    getMemory().steps.set(runId, steps);
    return { run, steps };
  }

  const supabase = createServiceClient();
  const { error: runError } = await supabase.from("project_setup_runs").insert({
    id: run.id,
    status: run.status,
    dry_run: run.dryRun,
    initiated_by: run.initiatedBy,
    trigger_channel: run.triggerChannel,
    slack_initiator_id: run.slackInitiatorId,
    ghl_contact_id: run.ghlContactId,
    contact_snapshot_json: run.contactSnapshot,
    sales_rep: run.salesRep,
    project_number: run.projectNumber,
    project_last_name: run.projectLastName,
    folder_name: run.folderName,
    charter_name: run.charterName,
    slack_channel_name: run.slackChannelName,
    fp_paid_date: run.fpPaidDate,
  });
  if (runError) {
    if (runError.code === "23505") {
      throw new Error(
        `Project number ${run.projectNumber} is already in use by another active setup run.`,
      );
    }
    throw runError;
  }

  const { error: stepsError } = await supabase.from("project_setup_steps").insert(
    steps.map((s) => ({
      id: s.id,
      run_id: s.runId,
      step_key: s.stepKey,
      order_index: s.orderIndex,
      status: s.status,
      output_json: {},
    })),
  );
  if (stepsError) throw stepsError;

  return { run, steps };
}

/**
 * Insert any step keys missing from an older run (e.g. after Prompt 3 added
 * append_charter_list_row) and sync order_index to the current definition order.
 */
export async function ensureProjectSetupStepRows(runId: string): Promise<ProjectSetupStep[]> {
  const existing = await getProjectSetupSteps(runId);
  const byKey = new Map(existing.map((s) => [s.stepKey, s]));
  const now = new Date().toISOString();
  const toInsert: ProjectSetupStep[] = [];
  const orderFixes: Array<{ id: string; orderIndex: number }> = [];

  for (let index = 0; index < PROJECT_SETUP_STEP_KEYS.length; index += 1) {
    const key = PROJECT_SETUP_STEP_KEYS[index]!;
    const row = byKey.get(key);
    if (!row) {
      toInsert.push({
        id: crypto.randomUUID(),
        runId,
        stepKey: key,
        orderIndex: index,
        status: "pending",
        outputJson: {},
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    if (row.orderIndex !== index) {
      orderFixes.push({ id: row.id, orderIndex: index });
    }
  }

  if (usesMemoryStore()) {
    const next = [...existing];
    for (const fix of orderFixes) {
      const idx = next.findIndex((s) => s.id === fix.id);
      if (idx >= 0) next[idx] = { ...next[idx]!, orderIndex: fix.orderIndex, updatedAt: now };
    }
    next.push(...toInsert);
    getMemory().steps.set(runId, next);
    return getProjectSetupSteps(runId);
  }

  const supabase = createServiceClient();
  if (toInsert.length > 0) {
    const { error } = await supabase.from("project_setup_steps").insert(
      toInsert.map((s) => ({
        id: s.id,
        run_id: s.runId,
        step_key: s.stepKey,
        order_index: s.orderIndex,
        status: s.status,
        output_json: {},
      })),
    );
    if (error) throw error;
  }
  for (const fix of orderFixes) {
    const { error } = await supabase
      .from("project_setup_steps")
      .update({ order_index: fix.orderIndex, updated_at: now })
      .eq("id", fix.id);
    if (error) throw error;
  }

  return getProjectSetupSteps(runId);
}

export async function getProjectSetupRun(runId: string): Promise<ProjectSetupRun | null> {
  if (usesMemoryStore()) return getMemory().runs.get(runId) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("project_setup_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRun(data as RunRow) : null;
}

export async function listProjectSetupRuns(limit = 25): Promise<ProjectSetupRun[]> {
  if (usesMemoryStore()) {
    return [...getMemory().runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("project_setup_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RunRow[]) ?? []).map(mapRun);
}

export async function getProjectSetupSteps(runId: string): Promise<ProjectSetupStep[]> {
  if (usesMemoryStore()) {
    return [...(getMemory().steps.get(runId) ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("project_setup_steps")
    .select("*")
    .eq("run_id", runId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return ((data as StepRow[]) ?? []).map(mapStep);
}

export async function updateProjectSetupRun(
  runId: string,
  patch: Partial<{
    status: ProjectSetupRunStatus;
    projectNumber: string | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    folderName: string | null;
    charterName: string | null;
    slackChannelName: string | null;
    projectLastName: string | null;
  }>,
): Promise<ProjectSetupRun> {
  if (usesMemoryStore()) {
    const existing = getMemory().runs.get(runId);
    if (!existing) throw new Error("Run not found");
    const next = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    getMemory().runs.set(runId, next);
    return next;
  }

  const supabase = createServiceClient();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.projectNumber !== undefined) payload.project_number = patch.projectNumber;
  if (patch.error !== undefined) payload.error = patch.error;
  if (patch.startedAt !== undefined) payload.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) payload.finished_at = patch.finishedAt;
  if (patch.folderName !== undefined) payload.folder_name = patch.folderName;
  if (patch.charterName !== undefined) payload.charter_name = patch.charterName;
  if (patch.slackChannelName !== undefined) payload.slack_channel_name = patch.slackChannelName;
  if (patch.projectLastName !== undefined) payload.project_last_name = patch.projectLastName;

  const { data, error } = await supabase
    .from("project_setup_runs")
    .update(payload)
    .eq("id", runId)
    .select("*")
    .single();
  if (error) throw error;
  return mapRun(data as RunRow);
}

export async function updateProjectSetupStep(
  stepId: string,
  patch: Partial<{
    status: ProjectSetupStepStatus;
    outputJson: Record<string, unknown>;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>,
): Promise<ProjectSetupStep> {
  if (usesMemoryStore()) {
    for (const [runId, steps] of getMemory().steps.entries()) {
      const idx = steps.findIndex((s) => s.id === stepId);
      if (idx < 0) continue;
      const next = {
        ...steps[idx]!,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const copy = [...steps];
      copy[idx] = next;
      getMemory().steps.set(runId, copy);
      return next;
    }
    throw new Error("Step not found");
  }

  const supabase = createServiceClient();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.outputJson !== undefined) payload.output_json = patch.outputJson;
  if (patch.error !== undefined) payload.error = patch.error;
  if (patch.startedAt !== undefined) payload.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) payload.finished_at = patch.finishedAt;

  const { data, error } = await supabase
    .from("project_setup_steps")
    .update(payload)
    .eq("id", stepId)
    .select("*")
    .single();
  if (error) throw error;
  return mapStep(data as StepRow);
}

/** Stale after 20 minutes — folder copy can exceed the job reclaim window. */
export const PROJECT_SETUP_EXECUTION_LOCK_STALE_MS = 20 * 60_000;

/**
 * Conditional run-level lease (same pattern as claimNextJob). Only one executor
 * may hold the lock; a second near-simultaneous caller gets acquired: false.
 */
export async function tryAcquireProjectSetupExecution(
  runId: string,
): Promise<{ acquired: boolean; token: string | null }> {
  const token = randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - PROJECT_SETUP_EXECUTION_LOCK_STALE_MS).toISOString();

  if (usesMemoryStore()) {
    const locks = getMemory().executionLocks;
    const existing = locks.get(runId);
    if (existing && existing.lockedAt >= staleBefore) {
      return { acquired: false, token: null };
    }
    locks.set(runId, { token, lockedAt: now });
    return { acquired: true, token };
  }

  const supabase = createServiceClient();
  const { data: row, error: readError } = await supabase
    .from("project_setup_runs")
    .select("id, execution_lock_token, execution_locked_at")
    .eq("id", runId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error("Project setup run not found");

  const lockedAt = typeof row.execution_locked_at === "string" ? row.execution_locked_at : null;
  const heldToken =
    typeof row.execution_lock_token === "string" && row.execution_lock_token.length > 0
      ? row.execution_lock_token
      : null;
  const held = heldToken !== null && lockedAt !== null && lockedAt >= staleBefore;

  if (held) {
    return { acquired: false, token: null };
  }

  let query = supabase
    .from("project_setup_runs")
    .update({
      execution_lock_token: token,
      execution_locked_at: now,
      updated_at: now,
    })
    .eq("id", runId);

  if (heldToken) {
    query = query.eq("execution_lock_token", heldToken);
  } else {
    query = query.is("execution_lock_token", null);
  }

  const { data: updated, error } = await query.select("id").maybeSingle();

  if (error) throw error;
  if (!updated) {
    return { acquired: false, token: null };
  }
  return { acquired: true, token };
}

export async function heartbeatProjectSetupExecution(runId: string, token: string): Promise<void> {
  const now = new Date().toISOString();
  if (usesMemoryStore()) {
    const existing = getMemory().executionLocks.get(runId);
    if (!existing || existing.token !== token) return;
    getMemory().executionLocks.set(runId, { token, lockedAt: now });
    return;
  }

  const supabase = createServiceClient();
  await supabase
    .from("project_setup_runs")
    .update({ execution_locked_at: now, updated_at: now })
    .eq("id", runId)
    .eq("execution_lock_token", token);
}

export async function releaseProjectSetupExecution(runId: string, token: string): Promise<void> {
  const now = new Date().toISOString();
  if (usesMemoryStore()) {
    const existing = getMemory().executionLocks.get(runId);
    if (!existing || existing.token !== token) return;
    getMemory().executionLocks.delete(runId);
    return;
  }

  const supabase = createServiceClient();
  await supabase
    .from("project_setup_runs")
    .update({
      execution_lock_token: null,
      execution_locked_at: null,
      updated_at: now,
    })
    .eq("id", runId)
    .eq("execution_lock_token", token);
}
