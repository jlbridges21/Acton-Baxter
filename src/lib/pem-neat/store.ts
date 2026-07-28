import { createHash, randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";
import { PEM_NEAT_STANDARD_VERSION } from "./constants";
import { pemNeatStoreError } from "./errors";
import type {
  CreatePemNeatRecordInput,
  PemNeatGenerationRow,
  PemNeatListItem,
  PemNeatRecord,
  SaveGenerationFailureInput,
  SaveGenerationSuccessInput,
} from "./types";

export function hashTranscript(transcript: string): string {
  return createHash("sha256").update(transcript, "utf8").digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function shouldUseMemoryPemNeatStore(): boolean {
  const env = getEnv();
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

type MemoryState = {
  neats: Map<string, PemNeatRecord>;
  generations: Map<string, PemNeatGenerationRow[]>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterPemNeatMemory?: MemoryState;
};

function getMemoryState(): MemoryState {
  if (!globalMemory.__baxterPemNeatMemory) {
    globalMemory.__baxterPemNeatMemory = {
      neats: new Map(),
      generations: new Map(),
    };
  }
  return globalMemory.__baxterPemNeatMemory;
}

export function resetPemNeatMemoryStoreForTests() {
  globalMemory.__baxterPemNeatMemory = {
    neats: new Map(),
    generations: new Map(),
  };
}

export interface PemNeatStore {
  create(input: CreatePemNeatRecordInput): Promise<PemNeatRecord>;
  get(id: string): Promise<PemNeatRecord | null>;
  list(options?: {
    query?: string;
    salespersonUserId?: string;
    status?: string;
    outcome?: string;
  }): Promise<PemNeatListItem[]>;
  markGenerating(id: string): Promise<PemNeatRecord>;
  saveGenerationSuccess(id: string, input: SaveGenerationSuccessInput): Promise<PemNeatRecord>;
  saveGenerationFailure(id: string, input: SaveGenerationFailureInput): Promise<PemNeatRecord>;
  listGenerations(id: string): Promise<PemNeatGenerationRow[]>;
}

function toListItem(row: PemNeatRecord): PemNeatListItem {
  return {
    id: row.id,
    prospect_name: row.prospect_name,
    salesperson_user_id: row.salesperson_user_id,
    salesperson_display_name: row.salesperson_display_name,
    meeting_date: row.meeting_date,
    status: row.status,
    meeting_outcome: row.meeting_outcome,
    qualification: row.qualification,
    created_at: row.created_at,
    updated_at: row.updated_at,
    generated_at: row.generated_at,
  };
}

class MemoryPemNeatStore implements PemNeatStore {
  async create(input: CreatePemNeatRecordInput): Promise<PemNeatRecord> {
    const id = randomUUID();
    const timestamp = nowIso();
    const record: PemNeatRecord = {
      id,
      prospect_name: input.prospectName.trim(),
      salesperson_user_id: input.salespersonUserId,
      salesperson_display_name: input.salespersonDisplayName.trim(),
      meeting_date: input.meetingDate ?? null,
      created_by: input.createdBy,
      status: "draft",
      transcript: input.transcript,
      transcript_hash: hashTranscript(input.transcript),
      transcript_char_count: input.transcript.length,
      meeting_outcome: null,
      qualification: null,
      neat_standard_version: PEM_NEAT_STANDARD_VERSION,
      generation_error: null,
      generated_at: null,
      regenerated_at: null,
      model_provider: null,
      model_name: null,
      generation_latency_ms: null,
      input_tokens: null,
      output_tokens: null,
      structured_result: {},
      buildertrend_fields: {},
      analysis_metadata: {},
      created_at: timestamp,
      updated_at: timestamp,
    };
    getMemoryState().neats.set(id, record);
    getMemoryState().generations.set(id, []);
    return structuredClone(record);
  }

  async get(id: string): Promise<PemNeatRecord | null> {
    const row = getMemoryState().neats.get(id);
    return row ? structuredClone(row) : null;
  }

  async list(options?: {
    query?: string;
    salespersonUserId?: string;
    status?: string;
    outcome?: string;
  }): Promise<PemNeatListItem[]> {
    let rows = Array.from(getMemoryState().neats.values());
    const q = options?.query?.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.prospect_name.toLowerCase().includes(q) ||
          r.salesperson_display_name.toLowerCase().includes(q),
      );
    }
    if (options?.salespersonUserId) {
      rows = rows.filter((r) => r.salesperson_user_id === options.salespersonUserId);
    }
    if (options?.status) {
      rows = rows.filter((r) => r.status === options.status);
    }
    if (options?.outcome) {
      rows = rows.filter((r) => r.meeting_outcome === options.outcome);
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows.map(toListItem);
  }

  async markGenerating(id: string): Promise<PemNeatRecord> {
    const existing = getMemoryState().neats.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");
    const updated: PemNeatRecord = {
      ...existing,
      status: "generating",
      generation_error: null,
      updated_at: nowIso(),
    };
    getMemoryState().neats.set(id, updated);
    return structuredClone(updated);
  }

  async saveGenerationSuccess(
    id: string,
    input: SaveGenerationSuccessInput,
  ): Promise<PemNeatRecord> {
    const existing = getMemoryState().neats.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");
    const timestamp = nowIso();
    const gens = getMemoryState().generations.get(id) ?? [];
    const generationIndex = gens.length + 1;
    const genRow: PemNeatGenerationRow = {
      id: randomUUID(),
      pem_neat_id: id,
      generation_index: generationIndex,
      status: "completed",
      model_provider: input.modelProvider,
      model_name: input.modelName,
      neat_standard_version: input.neatStandardVersion,
      structured_result: input.structuredResult,
      buildertrend_fields: input.buildertrendFields,
      analysis_metadata: input.analysisMetadata,
      error_message: null,
      latency_ms: input.latencyMs,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      created_at: timestamp,
    };
    gens.push(genRow);
    getMemoryState().generations.set(id, gens);

    const updated: PemNeatRecord = {
      ...existing,
      status: "completed",
      meeting_outcome: input.meetingOutcome,
      qualification: input.qualification,
      structured_result: input.structuredResult,
      buildertrend_fields: input.buildertrendFields,
      analysis_metadata: input.analysisMetadata,
      neat_standard_version: input.neatStandardVersion,
      generation_error: null,
      generated_at: existing.generated_at ?? timestamp,
      regenerated_at: existing.generated_at ? timestamp : null,
      model_provider: input.modelProvider,
      model_name: input.modelName,
      generation_latency_ms: input.latencyMs,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      updated_at: timestamp,
    };
    getMemoryState().neats.set(id, updated);
    return structuredClone(updated);
  }

  async saveGenerationFailure(
    id: string,
    input: SaveGenerationFailureInput,
  ): Promise<PemNeatRecord> {
    const existing = getMemoryState().neats.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");
    const timestamp = nowIso();
    const gens = getMemoryState().generations.get(id) ?? [];
    gens.push({
      id: randomUUID(),
      pem_neat_id: id,
      generation_index: gens.length + 1,
      status: "failed",
      model_provider: input.modelProvider ?? null,
      model_name: input.modelName ?? null,
      neat_standard_version: existing.neat_standard_version,
      structured_result: {},
      buildertrend_fields: {},
      analysis_metadata: {},
      error_message: input.errorMessage,
      latency_ms: input.latencyMs ?? null,
      input_tokens: null,
      output_tokens: null,
      created_at: timestamp,
    });
    getMemoryState().generations.set(id, gens);

    // Preserve last successful structured result.
    const updated: PemNeatRecord = {
      ...existing,
      status: existing.generated_at ? "completed" : "failed",
      generation_error: input.errorMessage,
      model_provider: input.modelProvider ?? existing.model_provider,
      model_name: input.modelName ?? existing.model_name,
      generation_latency_ms: input.latencyMs ?? existing.generation_latency_ms,
      updated_at: timestamp,
    };
    getMemoryState().neats.set(id, updated);
    return structuredClone(updated);
  }

  async listGenerations(id: string): Promise<PemNeatGenerationRow[]> {
    return structuredClone(getMemoryState().generations.get(id) ?? []);
  }
}

function mapRow(row: Record<string, unknown>): PemNeatRecord {
  return {
    id: String(row.id),
    prospect_name: String(row.prospect_name),
    salesperson_user_id: row.salesperson_user_id ? String(row.salesperson_user_id) : null,
    salesperson_display_name: String(row.salesperson_display_name),
    meeting_date: row.meeting_date ? String(row.meeting_date) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    status: row.status as PemNeatRecord["status"],
    transcript: String(row.transcript ?? ""),
    transcript_hash: row.transcript_hash ? String(row.transcript_hash) : null,
    transcript_char_count: Number(row.transcript_char_count ?? 0),
    meeting_outcome: (row.meeting_outcome as PemNeatRecord["meeting_outcome"]) ?? null,
    qualification: (row.qualification as PemNeatRecord["qualification"]) ?? null,
    neat_standard_version: String(row.neat_standard_version ?? PEM_NEAT_STANDARD_VERSION),
    generation_error: row.generation_error ? String(row.generation_error) : null,
    generated_at: row.generated_at ? String(row.generated_at) : null,
    regenerated_at: row.regenerated_at ? String(row.regenerated_at) : null,
    model_provider: row.model_provider ? String(row.model_provider) : null,
    model_name: row.model_name ? String(row.model_name) : null,
    generation_latency_ms:
      row.generation_latency_ms != null ? Number(row.generation_latency_ms) : null,
    input_tokens: row.input_tokens != null ? Number(row.input_tokens) : null,
    output_tokens: row.output_tokens != null ? Number(row.output_tokens) : null,
    structured_result: (row.structured_result as PemNeatRecord["structured_result"]) ?? {},
    buildertrend_fields: (row.buildertrend_fields as PemNeatRecord["buildertrend_fields"]) ?? {},
    analysis_metadata: (row.analysis_metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

class SupabasePemNeatStore implements PemNeatStore {
  async create(input: CreatePemNeatRecordInput): Promise<PemNeatRecord> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neats")
      .insert({
        prospect_name: input.prospectName.trim(),
        salesperson_user_id: input.salespersonUserId,
        salesperson_display_name: input.salespersonDisplayName.trim(),
        meeting_date: input.meetingDate ?? null,
        created_by: input.createdBy,
        status: "draft",
        transcript: input.transcript,
        transcript_hash: hashTranscript(input.transcript),
        transcript_char_count: input.transcript.length,
        neat_standard_version: PEM_NEAT_STANDARD_VERSION,
      })
      .select("*")
      .single();
    if (error) throw pemNeatStoreError(error, "Unable to create PEM NEAT");
    return mapRow(data as Record<string, unknown>);
  }

  async get(id: string): Promise<PemNeatRecord | null> {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("pem_neats").select("*").eq("id", id).maybeSingle();
    if (error) throw pemNeatStoreError(error, "Unable to load PEM NEAT");
    return data ? mapRow(data as Record<string, unknown>) : null;
  }

  async list(options?: {
    query?: string;
    salespersonUserId?: string;
    status?: string;
    outcome?: string;
  }): Promise<PemNeatListItem[]> {
    const supabase = createServiceClient();
    let query = supabase
      .from("pem_neats")
      .select(
        "id, prospect_name, salesperson_user_id, salesperson_display_name, meeting_date, status, meeting_outcome, qualification, created_at, updated_at, generated_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (options?.salespersonUserId) {
      query = query.eq("salesperson_user_id", options.salespersonUserId);
    }
    if (options?.status) {
      query = query.eq("status", options.status);
    }
    if (options?.outcome) {
      query = query.eq("meeting_outcome", options.outcome);
    }
    if (options?.query?.trim()) {
      const q = options.query.trim();
      query = query.or(`prospect_name.ilike.%${q}%,salesperson_display_name.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw pemNeatStoreError(error);
    return (data ?? []).map((row) => toListItem(mapRow(row as Record<string, unknown>)));
  }

  async markGenerating(id: string): Promise<PemNeatRecord> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neats")
      .update({ status: "generating", generation_error: null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw pemNeatStoreError(error);
    return mapRow(data as Record<string, unknown>);
  }

  async saveGenerationSuccess(
    id: string,
    input: SaveGenerationSuccessInput,
  ): Promise<PemNeatRecord> {
    const supabase = createServiceClient();
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");

    const { data: genRows } = await supabase
      .from("pem_neat_generations")
      .select("generation_index")
      .eq("pem_neat_id", id)
      .order("generation_index", { ascending: false })
      .limit(1);
    const nextIndex = ((genRows?.[0]?.generation_index as number | undefined) ?? 0) + 1;

    const { error: genError } = await supabase.from("pem_neat_generations").insert({
      pem_neat_id: id,
      generation_index: nextIndex,
      status: "completed",
      model_provider: input.modelProvider,
      model_name: input.modelName,
      neat_standard_version: input.neatStandardVersion,
      structured_result: input.structuredResult,
      buildertrend_fields: input.buildertrendFields,
      analysis_metadata: input.analysisMetadata,
      latency_ms: input.latencyMs,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
    });
    if (genError) throw pemNeatStoreError(genError, "Unable to save PEM NEAT generation history");

    const timestamp = nowIso();
    const { data, error } = await supabase
      .from("pem_neats")
      .update({
        status: "completed",
        meeting_outcome: input.meetingOutcome,
        qualification: input.qualification,
        structured_result: input.structuredResult,
        buildertrend_fields: input.buildertrendFields,
        analysis_metadata: input.analysisMetadata,
        neat_standard_version: input.neatStandardVersion,
        generation_error: null,
        generated_at: existing.generated_at ?? timestamp,
        regenerated_at: existing.generated_at ? timestamp : null,
        model_provider: input.modelProvider,
        model_name: input.modelName,
        generation_latency_ms: input.latencyMs,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw pemNeatStoreError(error);
    return mapRow(data as Record<string, unknown>);
  }

  async saveGenerationFailure(
    id: string,
    input: SaveGenerationFailureInput,
  ): Promise<PemNeatRecord> {
    const supabase = createServiceClient();
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");

    const { data: genRows } = await supabase
      .from("pem_neat_generations")
      .select("generation_index")
      .eq("pem_neat_id", id)
      .order("generation_index", { ascending: false })
      .limit(1);
    const nextIndex = ((genRows?.[0]?.generation_index as number | undefined) ?? 0) + 1;

    await supabase.from("pem_neat_generations").insert({
      pem_neat_id: id,
      generation_index: nextIndex,
      status: "failed",
      model_provider: input.modelProvider ?? null,
      model_name: input.modelName ?? null,
      neat_standard_version: existing.neat_standard_version,
      error_message: input.errorMessage,
      latency_ms: input.latencyMs ?? null,
    });

    const { data, error } = await supabase
      .from("pem_neats")
      .update({
        status: existing.generated_at ? "completed" : "failed",
        generation_error: input.errorMessage,
        model_provider: input.modelProvider ?? existing.model_provider,
        model_name: input.modelName ?? existing.model_name,
        generation_latency_ms: input.latencyMs ?? existing.generation_latency_ms,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw pemNeatStoreError(error);
    return mapRow(data as Record<string, unknown>);
  }

  async listGenerations(id: string): Promise<PemNeatGenerationRow[]> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neat_generations")
      .select("*")
      .eq("pem_neat_id", id)
      .order("generation_index", { ascending: true });
    if (error) throw pemNeatStoreError(error);
    return (data ?? []).map((row) => ({
      id: String(row.id),
      pem_neat_id: String(row.pem_neat_id),
      generation_index: Number(row.generation_index),
      status: row.status as "completed" | "failed",
      model_provider: row.model_provider ? String(row.model_provider) : null,
      model_name: row.model_name ? String(row.model_name) : null,
      neat_standard_version: String(row.neat_standard_version),
      structured_result: (row.structured_result as PemNeatGenerationRow["structured_result"]) ?? {},
      buildertrend_fields:
        (row.buildertrend_fields as PemNeatGenerationRow["buildertrend_fields"]) ?? {},
      analysis_metadata: (row.analysis_metadata as Record<string, unknown>) ?? {},
      error_message: row.error_message ? String(row.error_message) : null,
      latency_ms: row.latency_ms != null ? Number(row.latency_ms) : null,
      input_tokens: row.input_tokens != null ? Number(row.input_tokens) : null,
      output_tokens: row.output_tokens != null ? Number(row.output_tokens) : null,
      created_at: String(row.created_at),
    }));
  }
}

export function getPemNeatStore(): PemNeatStore {
  if (shouldUseMemoryPemNeatStore()) {
    return new MemoryPemNeatStore();
  }
  return new SupabasePemNeatStore();
}
