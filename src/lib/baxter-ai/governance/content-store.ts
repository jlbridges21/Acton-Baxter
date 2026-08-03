import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { isAdminRole, isSuperAdminRole } from "@/lib/auth/roles";
import {
  DEFAULT_GOVERNANCE_SECTION_CONTENT,
  GOVERNANCE_DOMAINS,
  GOVERNANCE_SECTION_KEYS,
  SECTION_DOMAIN,
  type GovernanceDomain,
  type GovernanceSectionKey,
} from "./section-meta";

export type GovernanceVersionStatus = "draft" | "active" | "superseded";

export type GovernanceVersion = {
  id: string;
  version_number: number;
  status: GovernanceVersionStatus;
  proposed_by: string | null;
  rationale: string | null;
  created_at: string;
  activated_at: string | null;
  activated_by: string | null;
  superseded_version_id: string | null;
};

export type GovernanceVersionSection = {
  version_id: string;
  section_key: GovernanceSectionKey;
  content: string;
  domain: GovernanceDomain;
};

export type GovernanceDomainOwner = {
  domain: GovernanceDomain;
  profile_id: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type GovernanceSectionApproval = {
  version_id: string;
  section_key: GovernanceSectionKey;
  approved_by: string;
  approved_at: string;
};

type MemoryState = {
  versions: Map<string, GovernanceVersion>;
  sections: Map<string, GovernanceVersionSection>; // `${versionId}:${sectionKey}`
  owners: Map<GovernanceDomain, GovernanceDomainOwner>;
  approvals: Map<string, GovernanceSectionApproval>; // `${versionId}:${sectionKey}`
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterGovernanceMemory?: MemoryState;
};

function nowIso() {
  return new Date().toISOString();
}

function getMemory(): MemoryState {
  if (!globalMemory.__baxterGovernanceMemory) {
    globalMemory.__baxterGovernanceMemory = seedMemoryFromDefaults();
  }
  return globalMemory.__baxterGovernanceMemory;
}

function usesMemoryStore(): boolean {
  try {
    const env = getEnv();
    return (
      env.E2E_TEST_AUTH_BYPASS ||
      (env.ENABLE_MOCK_RESEARCH && env.NODE_ENV !== "production") ||
      env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
    );
  } catch {
    // Incomplete env must never crash prompt assembly — prefer memory/compiled fallback.
    return (
      process.env.ENABLE_MOCK_RESEARCH === "true" ||
      process.env.NODE_ENV === "test" ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL
    );
  }
}

function seedMemoryFromDefaults(): MemoryState {
  const id = "a0000000-0000-4000-8000-000000000001";
  const timestamp = nowIso();
  const versions = new Map<string, GovernanceVersion>();
  versions.set(id, {
    id,
    version_number: 1,
    status: "active",
    proposed_by: null,
    rationale: "Initial seed: verbatim compiled defaults",
    created_at: timestamp,
    activated_at: timestamp,
    activated_by: null,
    superseded_version_id: null,
  });
  const sections = new Map<string, GovernanceVersionSection>();
  for (const key of GOVERNANCE_SECTION_KEYS) {
    sections.set(`${id}:${key}`, {
      version_id: id,
      section_key: key,
      content: DEFAULT_GOVERNANCE_SECTION_CONTENT[key],
      domain: SECTION_DOMAIN[key],
    });
  }
  const owners = new Map<GovernanceDomain, GovernanceDomainOwner>();
  for (const domain of GOVERNANCE_DOMAINS) {
    owners.set(domain, {
      domain,
      profile_id: null,
      updated_by: null,
      updated_at: timestamp,
    });
  }
  return { versions, sections, owners, approvals: new Map() };
}

export function resetGovernanceMemoryForTests(): void {
  globalMemory.__baxterGovernanceMemory = seedMemoryFromDefaults();
}

export type ActiveGovernanceContent = {
  versionNumber: number;
  versionId: string;
  sections: Record<GovernanceSectionKey, string>;
  usedFallback: boolean;
  fallbackReason: string | null;
};

function defaultActiveContent(reason: string): ActiveGovernanceContent {
  console.error(`[governance] FALLBACK to compiled defaults: ${reason}`);
  return {
    versionNumber: 0,
    versionId: "compiled-fallback",
    sections: { ...DEFAULT_GOVERNANCE_SECTION_CONTENT },
    usedFallback: true,
    fallbackReason: reason,
  };
}

/**
 * Fresh read of active governance section content for this request.
 * Falls back to compiled-in defaults if DB is unreachable or incomplete — never empty.
 */
export async function loadActiveGovernanceContent(): Promise<ActiveGovernanceContent> {
  try {
    if (usesMemoryStore()) {
      const mem = getMemory();
      const active = [...mem.versions.values()].find((v) => v.status === "active");
      if (!active) return defaultActiveContent("no_active_version_in_memory");
      const sections = {} as Record<GovernanceSectionKey, string>;
      for (const key of GOVERNANCE_SECTION_KEYS) {
        const row = mem.sections.get(`${active.id}:${key}`);
        if (!row?.content) {
          return defaultActiveContent(`missing_section_${key}`);
        }
        sections[key] = row.content;
      }
      return {
        versionNumber: active.version_number,
        versionId: active.id,
        sections,
        usedFallback: false,
        fallbackReason: null,
      };
    }

    const supabase = createServiceClient();
    const { data: active, error } = await supabase
      .from("governance_versions")
      .select("*")
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      return defaultActiveContent(`db_error:${error.message}`);
    }
    if (!active) {
      return defaultActiveContent("no_active_version");
    }

    const { data: rows, error: sectionError } = await supabase
      .from("governance_version_sections")
      .select("section_key, content")
      .eq("version_id", active.id);

    if (sectionError) {
      return defaultActiveContent(`sections_error:${sectionError.message}`);
    }

    const byKey = new Map(
      (rows ?? []).map((r) => [r.section_key as GovernanceSectionKey, r.content as string]),
    );
    const sections = {} as Record<GovernanceSectionKey, string>;
    for (const key of GOVERNANCE_SECTION_KEYS) {
      const content = byKey.get(key);
      if (!content) {
        return defaultActiveContent(`missing_section_${key}`);
      }
      sections[key] = content;
    }

    return {
      versionNumber: active.version_number as number,
      versionId: active.id as string,
      sections,
      usedFallback: false,
      fallbackReason: null,
    };
  } catch (err) {
    return defaultActiveContent(`exception:${err instanceof Error ? err.message : "unknown"}`);
  }
}

export async function getActiveGovernanceVersion(): Promise<GovernanceVersion | null> {
  if (usesMemoryStore()) {
    return [...getMemory().versions.values()].find((v) => v.status === "active") ?? null;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("governance_versions")
    .select("*")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return (data as GovernanceVersion | null) ?? null;
}

export async function listGovernanceVersions(): Promise<GovernanceVersion[]> {
  if (usesMemoryStore()) {
    return [...getMemory().versions.values()].sort((a, b) => b.version_number - a.version_number);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("governance_versions")
    .select("*")
    .order("version_number", { ascending: false });
  if (error) throw error;
  return (data as GovernanceVersion[]) ?? [];
}

export async function getGovernanceVersionSections(
  versionId: string,
): Promise<GovernanceVersionSection[]> {
  if (usesMemoryStore()) {
    return [...getMemory().sections.values()].filter((s) => s.version_id === versionId);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("governance_version_sections")
    .select("*")
    .eq("version_id", versionId);
  if (error) throw error;
  return (data as GovernanceVersionSection[]) ?? [];
}

export async function listDomainOwners(): Promise<GovernanceDomainOwner[]> {
  if (usesMemoryStore()) {
    return GOVERNANCE_DOMAINS.map((d) => getMemory().owners.get(d)!);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("governance_domain_owners").select("*");
  if (error) throw error;
  return (data as GovernanceDomainOwner[]) ?? [];
}

export async function assignDomainOwner(
  domain: GovernanceDomain,
  profileId: string | null,
  updatedBy: string,
): Promise<GovernanceDomainOwner> {
  const row: GovernanceDomainOwner = {
    domain,
    profile_id: profileId,
    updated_by: updatedBy,
    updated_at: nowIso(),
  };
  if (usesMemoryStore()) {
    getMemory().owners.set(domain, row);
    return row;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("governance_domain_owners")
    .upsert(row, { onConflict: "domain" })
    .select("*")
    .single();
  if (error) throw error;
  return data as GovernanceDomainOwner;
}

export async function getOrCreateDraftVersion(proposedBy: string, rationale?: string | null) {
  if (usesMemoryStore()) {
    const mem = getMemory();
    const existing = [...mem.versions.values()].find((v) => v.status === "draft");
    if (existing) return existing;
    const active = [...mem.versions.values()].find((v) => v.status === "active");
    if (!active) throw new Error("No active governance version to draft from");
    const nextNum = Math.max(...[...mem.versions.values()].map((v) => v.version_number)) + 1;
    const id = randomUUID();
    const draft: GovernanceVersion = {
      id,
      version_number: nextNum,
      status: "draft",
      proposed_by: proposedBy,
      rationale: rationale ?? null,
      created_at: nowIso(),
      activated_at: null,
      activated_by: null,
      superseded_version_id: null,
    };
    mem.versions.set(id, draft);
    for (const key of GOVERNANCE_SECTION_KEYS) {
      const src = mem.sections.get(`${active.id}:${key}`)!;
      mem.sections.set(`${id}:${key}`, {
        version_id: id,
        section_key: key,
        content: src.content,
        domain: src.domain,
      });
    }
    return draft;
  }

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("governance_versions")
    .select("*")
    .eq("status", "draft")
    .maybeSingle();
  if (existing) return existing as GovernanceVersion;

  const { data: active } = await supabase
    .from("governance_versions")
    .select("*")
    .eq("status", "active")
    .single();
  if (!active) throw new Error("No active governance version to draft from");

  const { data: maxRow } = await supabase
    .from("governance_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNum = ((maxRow?.version_number as number | undefined) ?? 0) + 1;

  const { data: draft, error } = await supabase
    .from("governance_versions")
    .insert({
      version_number: nextNum,
      status: "draft",
      proposed_by: proposedBy,
      rationale: rationale ?? null,
    })
    .select("*")
    .single();
  if (error || !draft) throw error ?? new Error("Failed to create draft");

  const { data: sections } = await supabase
    .from("governance_version_sections")
    .select("*")
    .eq("version_id", active.id);
  if (sections?.length) {
    await supabase.from("governance_version_sections").insert(
      sections.map((s) => ({
        version_id: draft.id,
        section_key: s.section_key,
        content: s.content,
        domain: s.domain,
      })),
    );
  }
  return draft as GovernanceVersion;
}

export async function updateDraftSection(
  versionId: string,
  sectionKey: GovernanceSectionKey,
  content: string,
): Promise<void> {
  // Structure is code-fixed — reject unknown keys
  if (!GOVERNANCE_SECTION_KEYS.includes(sectionKey)) {
    throw new Error(`Unknown governance section: ${sectionKey}`);
  }

  if (usesMemoryStore()) {
    const mem = getMemory();
    const version = mem.versions.get(versionId);
    if (!version || version.status !== "draft") {
      throw new Error("Only draft versions can be edited");
    }
    mem.sections.set(`${versionId}:${sectionKey}`, {
      version_id: versionId,
      section_key: sectionKey,
      content,
      domain: SECTION_DOMAIN[sectionKey],
    });
    // Clear prior approval for this section when content changes
    mem.approvals.delete(`${versionId}:${sectionKey}`);
    return;
  }

  const supabase = createServiceClient();
  const { data: version } = await supabase
    .from("governance_versions")
    .select("status")
    .eq("id", versionId)
    .single();
  if (!version || version.status !== "draft") {
    throw new Error("Only draft versions can be edited");
  }

  const { error } = await supabase.from("governance_version_sections").upsert(
    {
      version_id: versionId,
      section_key: sectionKey,
      content,
      domain: SECTION_DOMAIN[sectionKey],
      updated_at: nowIso(),
    },
    { onConflict: "version_id,section_key" },
  );
  if (error) throw error;

  await supabase
    .from("governance_section_approvals")
    .delete()
    .eq("version_id", versionId)
    .eq("section_key", sectionKey);
}

export async function listSectionApprovals(
  versionId: string,
): Promise<GovernanceSectionApproval[]> {
  if (usesMemoryStore()) {
    return [...getMemory().approvals.values()].filter((a) => a.version_id === versionId);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("governance_section_approvals")
    .select("*")
    .eq("version_id", versionId);
  if (error) throw error;
  return (data as GovernanceSectionApproval[]) ?? [];
}

export async function approveDraftSection(input: {
  versionId: string;
  sectionKey: GovernanceSectionKey;
  approvedBy: string;
  role: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const owners = await listDomainOwners();
  const domain = SECTION_DOMAIN[input.sectionKey];
  const owner = owners.find((o) => o.domain === domain);
  const isOwner = owner?.profile_id === input.approvedBy;
  const isSuper = isSuperAdminRole(input.role);
  if (!isOwner && !isSuper) {
    return {
      ok: false,
      error: `Section "${input.sectionKey}" requires approval from the ${domain} domain owner or a super_admin`,
    };
  }

  if (usesMemoryStore()) {
    const version = getMemory().versions.get(input.versionId);
    if (!version || version.status !== "draft") {
      return { ok: false, error: "Only draft versions can be approved" };
    }
    getMemory().approvals.set(`${input.versionId}:${input.sectionKey}`, {
      version_id: input.versionId,
      section_key: input.sectionKey,
      approved_by: input.approvedBy,
      approved_at: nowIso(),
    });
    return { ok: true };
  }

  const supabase = createServiceClient();
  const { data: version } = await supabase
    .from("governance_versions")
    .select("status")
    .eq("id", input.versionId)
    .single();
  if (!version || version.status !== "draft") {
    return { ok: false, error: "Only draft versions can be approved" };
  }

  const { error } = await supabase.from("governance_section_approvals").upsert(
    {
      version_id: input.versionId,
      section_key: input.sectionKey,
      approved_by: input.approvedBy,
      approved_at: nowIso(),
    },
    { onConflict: "version_id,section_key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type ActivationGateResult =
  | { ok: true; changedSections: GovernanceSectionKey[] }
  | {
      ok: false;
      error: string;
      missingApprovals: Array<{
        sectionKey: GovernanceSectionKey;
        domain: GovernanceDomain;
      }>;
    };

export async function getActivationGate(versionId: string): Promise<ActivationGateResult> {
  const draftSections = await getGovernanceVersionSections(versionId);
  const active = await getActiveGovernanceVersion();
  if (!active) {
    return { ok: false, error: "No active version to compare against", missingApprovals: [] };
  }
  const activeSections = await getGovernanceVersionSections(active.id);
  const activeByKey = new Map(activeSections.map((s) => [s.section_key, s.content]));

  const changed: GovernanceSectionKey[] = [];
  for (const key of GOVERNANCE_SECTION_KEYS) {
    const draft = draftSections.find((s) => s.section_key === key);
    const prev = activeByKey.get(key) ?? "";
    if ((draft?.content ?? "") !== prev) {
      changed.push(key);
    }
  }

  const approvals = await listSectionApprovals(versionId);
  const approvedKeys = new Set(approvals.map((a) => a.section_key));
  const missing = changed
    .filter((key) => !approvedKeys.has(key))
    .map((sectionKey) => ({
      sectionKey,
      domain: SECTION_DOMAIN[sectionKey],
    }));

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Activation blocked — missing approvals for: ${missing
        .map((m) => `${m.sectionKey} (${m.domain})`)
        .join(", ")}`,
      missingApprovals: missing,
    };
  }

  return { ok: true, changedSections: changed };
}

export async function activateGovernanceVersion(
  versionId: string,
  activatedBy: string,
  role: string,
): Promise<ActivationGateResult & { version?: GovernanceVersion }> {
  if (!isAdminRole(role)) {
    return { ok: false, error: "Admin access required", missingApprovals: [] };
  }

  const gate = await getActivationGate(versionId);
  if (!gate.ok) return gate;

  if (usesMemoryStore()) {
    const mem = getMemory();
    const draft = mem.versions.get(versionId);
    if (!draft || draft.status !== "draft") {
      return { ok: false, error: "Version is not a draft", missingApprovals: [] };
    }
    const prior = [...mem.versions.values()].find((v) => v.status === "active");
    if (prior) {
      mem.versions.set(prior.id, {
        ...prior,
        status: "superseded",
      });
    }
    const activated: GovernanceVersion = {
      ...draft,
      status: "active",
      activated_at: nowIso(),
      activated_by: activatedBy,
      superseded_version_id: prior?.id ?? null,
    };
    mem.versions.set(versionId, activated);
    return { ok: true, changedSections: gate.changedSections, version: activated };
  }

  const supabase = createServiceClient();
  const { data: draft } = await supabase
    .from("governance_versions")
    .select("*")
    .eq("id", versionId)
    .single();
  if (!draft || draft.status !== "draft") {
    return { ok: false, error: "Version is not a draft", missingApprovals: [] };
  }

  const { data: prior } = await supabase
    .from("governance_versions")
    .select("id")
    .eq("status", "active")
    .maybeSingle();

  if (prior) {
    await supabase.from("governance_versions").update({ status: "superseded" }).eq("id", prior.id);
  }

  const { data: activated, error } = await supabase
    .from("governance_versions")
    .update({
      status: "active",
      activated_at: nowIso(),
      activated_by: activatedBy,
      superseded_version_id: prior?.id ?? null,
    })
    .eq("id", versionId)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message, missingApprovals: [] };
  }

  return {
    ok: true,
    changedSections: gate.changedSections,
    version: activated as GovernanceVersion,
  };
}

export function diffGovernanceSections(
  from: GovernanceVersionSection[],
  to: GovernanceVersionSection[],
): GovernanceSectionKey[] {
  const fromMap = new Map(from.map((s) => [s.section_key, s.content]));
  const changed: GovernanceSectionKey[] = [];
  for (const key of GOVERNANCE_SECTION_KEYS) {
    const a = fromMap.get(key) ?? "";
    const b = to.find((s) => s.section_key === key)?.content ?? "";
    if (a !== b) changed.push(key);
  }
  return changed;
}
