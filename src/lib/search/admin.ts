/**
 * Global Search administration: provider status, index lifecycle, field choices, synonyms,
 * and measured diagnostics. Callers must have verified an admin (requireAdmin) first; every
 * change is audited.
 */

import "server-only";

import { z } from "zod";
import { recordAudit } from "@/lib/agents/audit";
import { ValidationError } from "@/lib/errors";
import type { SearchContext } from "./context";
import { searchAll, withTimeout } from "./engine";
import {
  isIndexStale,
  purgeProviderIndex,
  reindexProvider,
  type ReindexResult,
} from "./index-store";
import { latencySummary } from "./metrics";
import { getSearchProvider, listSearchProviders } from "./registry";
import {
  deleteSynonym,
  effectiveFields,
  getProviderStates,
  isProviderEnabled,
  listSynonyms,
  saveProviderState,
  upsertSynonym,
  validateFieldSelection,
} from "./settings";
import { SOURCE_LABELS, categoryLabel } from "./types";

export async function getSearchAdminOverview() {
  const states = await getProviderStates();
  const metrics = latencySummary();
  const providers = await Promise.all(
    listSearchProviders().map(async (p) => {
      const state = states.get(p.id) ?? null;
      const availability = await withTimeout(p.availability(), 2000).catch(() => ({
        available: false,
        reason: "Couldn't check availability.",
      }));
      const enabledFields = effectiveFields(p, state);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        categoryLabel: categoryLabel(p.category),
        source: SOURCE_LABELS[p.sourceSystem],
        description: p.description,
        indexing: p.indexing,
        optional: p.optional,
        enabled: isProviderEnabled(p, state),
        permissionSummary: p.permissionSummary,
        available: availability.available,
        availabilityReason: availability.reason ?? null,
        timeoutMs: p.timeoutMs,
        minQueryLength: p.minQueryLength,
        fields: p.searchableFields.map((f) => ({
          key: f.key,
          label: f.label,
          sensitivity: f.sensitivity,
          enabled: f.sensitivity === "standard" && enabledFields.has(f.key),
        })),
        index:
          p.indexing === "index"
            ? {
                status: state?.last_index_status ?? "never",
                lastIndexedAt: state?.last_indexed_at ?? null,
                count: state?.indexed_count ?? 0,
                durationMs: state?.last_index_duration_ms ?? null,
                error: state?.last_index_error ?? null,
                trigger: state?.last_index_trigger ?? null,
                refreshMinutes: p.indexer?.refreshMinutes ?? null,
              }
            : null,
        latency: metrics.providers[p.id] ?? null,
      };
    }),
  );
  return { providers, overall: metrics.overall, synonyms: await listSynonyms() };
}

export const adminCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reindex"), provider: z.string().max(60) }),
  z.object({ op: z.literal("set_enabled"), provider: z.string().max(60), enabled: z.boolean() }),
  z.object({
    op: z.literal("set_fields"),
    provider: z.string().max(60),
    fields: z.array(z.string().max(60)).max(40),
  }),
  z.object({
    op: z.literal("upsert_synonym"),
    term: z.string().max(40),
    synonyms: z.array(z.string().max(40)).max(10),
  }),
  z.object({ op: z.literal("delete_synonym"), term: z.string().max(40) }),
  z.object({ op: z.literal("diagnose"), query: z.string().min(1).max(120) }),
]);

export type AdminCommand = z.infer<typeof adminCommandSchema>;

function requireProvider(id: string) {
  const p = getSearchProvider(id);
  if (!p) throw new ValidationError("Unknown search provider.");
  return p;
}

export async function runSearchAdminCommand(ctx: SearchContext, raw: unknown) {
  const cmd = adminCommandSchema.parse(raw);
  const actor = { userId: ctx.user.id, label: ctx.user.label };
  switch (cmd.op) {
    case "reindex": {
      const targets =
        cmd.provider === "all"
          ? listSearchProviders().filter((p) => p.indexing === "index")
          : [requireProvider(cmd.provider)];
      const results: ReindexResult[] = [];
      for (const p of targets) results.push(await reindexProvider(p, `admin:${ctx.user.id}`));
      await recordAudit({
        actor,
        action: "search.reindex",
        targetType: "global_search",
        targetId: cmd.provider,
        summary: `Reindexed ${targets.map((t) => t.name).join(", ")}.`,
      });
      return { results };
    }
    case "set_enabled": {
      const p = requireProvider(cmd.provider);
      if (!p.optional)
        throw new ValidationError(`${p.name} is a core provider and can't be turned off.`);
      await saveProviderState(p.id, { enabled: cmd.enabled, updated_by: ctx.user.id });
      // Disabling removes indexed rows right away; re-enabling rebuilds on the next search.
      if (!cmd.enabled && p.indexing === "index")
        await purgeProviderIndex(p, "Disabled by an admin");
      await recordAudit({
        actor,
        action: cmd.enabled ? "search.provider_enabled" : "search.provider_disabled",
        targetType: "global_search",
        targetId: p.id,
        summary: `${cmd.enabled ? "Enabled" : "Disabled"} ${p.name} in Global Search.`,
      });
      return { ok: true };
    }
    case "set_fields": {
      const p = requireProvider(cmd.provider);
      const fields = validateFieldSelection(p, cmd.fields);
      await saveProviderState(p.id, { searchable_fields: fields, updated_by: ctx.user.id });
      // Field changes alter what's in the index: rebuild so removed fields leave it immediately.
      if (p.indexing === "index") await reindexProvider(p, `fields:${ctx.user.id}`);
      await recordAudit({
        actor,
        action: "search.fields_changed",
        targetType: "global_search",
        targetId: p.id,
        summary: `Set ${p.name} searchable fields: ${fields.join(", ") || "none"}.`,
      });
      return { ok: true };
    }
    case "upsert_synonym": {
      const row = await upsertSynonym({
        term: cmd.term,
        synonyms: cmd.synonyms,
        actorId: ctx.user.id,
      });
      await recordAudit({
        actor,
        action: "search.synonym_saved",
        targetType: "global_search",
        targetId: row.term,
        summary: `Saved synonyms for "${row.term}".`,
      });
      return { synonym: row };
    }
    case "delete_synonym": {
      await deleteSynonym(cmd.term);
      await recordAudit({
        actor,
        action: "search.synonym_deleted",
        targetType: "global_search",
        targetId: cmd.term,
        summary: `Removed synonyms for "${cmd.term}".`,
      });
      return { ok: true };
    }
    case "diagnose": {
      // Runs as the admin; returns timing and counts only, never result contents.
      const run = await searchAll(ctx, { query: cmd.query, limit: 5, offset: 0 });
      return {
        tookMs: run.done?.tookMs ?? null,
        providers: run.outcomes.map((o) => ({
          provider: o.provider,
          name: o.name,
          status: o.status,
          count: o.count,
          latencyMs: o.latencyMs,
          message: o.message,
        })),
      };
    }
  }
}

/** Rebuild one provider's index after its source changed (e.g. a JobTread sync). */
export async function reindexProviderById(id: string, trigger: string) {
  const p = getSearchProvider(id);
  if (!p || p.indexing !== "index") return null;
  const state = (await getProviderStates()).get(id) ?? null;
  if (!isProviderEnabled(p, state)) return null;
  return reindexProvider(p, trigger);
}

/** Cron hook: refresh indexes whose interval elapsed. Never throws. */
export async function refreshStaleSearchIndexes(): Promise<
  Array<{ provider: string; status: string }>
> {
  const states = await getProviderStates().catch(() => new Map());
  const out: Array<{ provider: string; status: string }> = [];
  for (const p of listSearchProviders()) {
    if (p.indexing !== "index") continue;
    if (!isProviderEnabled(p, states.get(p.id) ?? null)) continue;
    try {
      if (!(await isIndexStale(p))) continue;
      const r = await reindexProvider(p, "schedule");
      out.push({ provider: p.id, status: r.status });
    } catch (error) {
      out.push({ provider: p.id, status: error instanceof Error ? "error" : "error" });
    }
  }
  return out;
}
