import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { ValidationError } from "@/lib/errors";
import type {
  JurisdictionRule,
  JurisdictionRuleValueJson,
  JurisdictionRuleWriteInput,
} from "./types";

type MemoryState = {
  rules: Map<string, JurisdictionRule>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterJurisdictionRulesMemory?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterJurisdictionRulesMemory) {
    globalMemory.__baxterJurisdictionRulesMemory = { rules: new Map() };
  }
  return globalMemory.__baxterJurisdictionRulesMemory;
}

export function resetJurisdictionRulesMemoryForTests() {
  globalMemory.__baxterJurisdictionRulesMemory = { rules: new Map() };
}

function nowIso() {
  return new Date().toISOString();
}

function shouldUseMemoryStore(): boolean {
  try {
    const env = getEnv();
    return (
      Boolean(env.ENABLE_MOCK_RESEARCH) ||
      env.E2E_TEST_AUTH_BYPASS ||
      env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
    );
  } catch {
    return true;
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRule(row: JurisdictionRule): JurisdictionRule {
  return {
    ...row,
    zone_key: emptyToNull(row.zone_key),
    notes: emptyToNull(row.notes),
    source_citation: row.source_citation.trim(),
    value_json: row.value_json as JurisdictionRuleValueJson,
  };
}

function uniqueKey(jurisdictionKey: string, ruleKey: string, zoneKey: string | null) {
  return `${jurisdictionKey}::${ruleKey}::${zoneKey ?? ""}`;
}

export async function listJurisdictionRules(options?: {
  jurisdictionKey?: string;
}): Promise<JurisdictionRule[]> {
  if (shouldUseMemoryStore()) {
    let rows = Array.from(getMemory().rules.values()).map(normalizeRule);
    if (options?.jurisdictionKey) {
      rows = rows.filter((row) => row.jurisdiction_key === options.jurisdictionKey);
    }
    return rows.sort((a, b) =>
      a.rule_key.localeCompare(b.rule_key) ||
      (a.zone_key ?? "").localeCompare(b.zone_key ?? "") ||
      a.created_at.localeCompare(b.created_at),
    );
  }

  const supabase = createServiceClient();
  let query = supabase.from("jurisdiction_rules").select("*").order("rule_key", { ascending: true });
  if (options?.jurisdictionKey) {
    query = query.eq("jurisdiction_key", options.jurisdictionKey);
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data as JurisdictionRule[]) ?? []).map(normalizeRule);
}

export async function getJurisdictionRule(id: string): Promise<JurisdictionRule | null> {
  if (shouldUseMemoryStore()) {
    const row = getMemory().rules.get(id);
    return row ? normalizeRule(row) : null;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("jurisdiction_rules")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeRule(data as JurisdictionRule) : null;
}

export async function createJurisdictionRule(
  input: JurisdictionRuleWriteInput,
  userId: string,
): Promise<JurisdictionRule> {
  const citation = input.source_citation.trim();
  if (!citation) {
    throw new ValidationError("Source citation is required");
  }
  const timestamp = nowIso();
  const rule: JurisdictionRule = {
    id: randomUUID(),
    jurisdiction_key: input.jurisdiction_key.trim(),
    rule_key: input.rule_key.trim(),
    zone_key: emptyToNull(input.zone_key),
    value_json: input.value_json,
    source_citation: citation,
    source_knowledge_entry_id: input.source_knowledge_entry_id ?? null,
    notes: emptyToNull(input.notes),
    created_by: userId,
    updated_by: userId,
    created_at: timestamp,
    updated_at: timestamp,
  };

  if (shouldUseMemoryStore()) {
    const key = uniqueKey(rule.jurisdiction_key, rule.rule_key, rule.zone_key);
    for (const existing of getMemory().rules.values()) {
      if (uniqueKey(existing.jurisdiction_key, existing.rule_key, existing.zone_key) === key) {
        throw new ValidationError(
          "A rule with this jurisdiction, rule key, and zone already exists",
        );
      }
    }
    getMemory().rules.set(rule.id, rule);
    return normalizeRule(rule);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("jurisdiction_rules").insert(rule).select("*").single();
  if (error) {
    if (error.code === "23505") {
      throw new ValidationError(
        "A rule with this jurisdiction, rule key, and zone already exists",
      );
    }
    throw error;
  }
  return normalizeRule(data as JurisdictionRule);
}

export async function updateJurisdictionRule(
  id: string,
  input: Partial<JurisdictionRuleWriteInput>,
  userId: string,
): Promise<JurisdictionRule> {
  const existing = await getJurisdictionRule(id);
  if (!existing) throw new ValidationError("Jurisdiction rule not found");

  const nextCitation =
    input.source_citation !== undefined ? input.source_citation.trim() : existing.source_citation;
  if (!nextCitation) {
    throw new ValidationError("Source citation is required");
  }

  const next: JurisdictionRule = {
    ...existing,
    jurisdiction_key:
      input.jurisdiction_key !== undefined
        ? input.jurisdiction_key.trim()
        : existing.jurisdiction_key,
    rule_key: input.rule_key !== undefined ? input.rule_key.trim() : existing.rule_key,
    zone_key: input.zone_key !== undefined ? emptyToNull(input.zone_key) : existing.zone_key,
    value_json: input.value_json ?? existing.value_json,
    source_citation: nextCitation,
    source_knowledge_entry_id:
      input.source_knowledge_entry_id !== undefined
        ? input.source_knowledge_entry_id
        : existing.source_knowledge_entry_id,
    notes: input.notes !== undefined ? emptyToNull(input.notes) : existing.notes,
    updated_by: userId,
    updated_at: nowIso(),
  };

  if (shouldUseMemoryStore()) {
    const key = uniqueKey(next.jurisdiction_key, next.rule_key, next.zone_key);
    for (const other of getMemory().rules.values()) {
      if (other.id === id) continue;
      if (uniqueKey(other.jurisdiction_key, other.rule_key, other.zone_key) === key) {
        throw new ValidationError(
          "A rule with this jurisdiction, rule key, and zone already exists",
        );
      }
    }
    getMemory().rules.set(id, next);
    return normalizeRule(next);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("jurisdiction_rules")
    .update({
      jurisdiction_key: next.jurisdiction_key,
      rule_key: next.rule_key,
      zone_key: next.zone_key,
      value_json: next.value_json,
      source_citation: next.source_citation,
      source_knowledge_entry_id: next.source_knowledge_entry_id,
      notes: next.notes,
      updated_by: userId,
      updated_at: next.updated_at,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new ValidationError(
        "A rule with this jurisdiction, rule key, and zone already exists",
      );
    }
    throw error;
  }
  return normalizeRule(data as JurisdictionRule);
}

export async function deleteJurisdictionRule(id: string): Promise<void> {
  if (shouldUseMemoryStore()) {
    if (!getMemory().rules.has(id)) {
      throw new ValidationError("Jurisdiction rule not found");
    }
    getMemory().rules.delete(id);
    return;
  }
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from("jurisdiction_rules")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new ValidationError("Jurisdiction rule not found");
}
