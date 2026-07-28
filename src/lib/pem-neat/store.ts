import { createHash, randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AppError, NotFoundError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";
import { PEM_NEAT_STANDARD_VERSION } from "./constants";
import { getPemNeatProviderTimeoutMs, pemNeatStoreError } from "./errors";
import type {
  CreatePemNeatRecordInput,
  PemNeatGenerationRow,
  PemNeatListItem,
  PemNeatRecord,
  SaveGenerationFailureInput,
  SaveGenerationSuccessInput,
  UpdatePemNeatSourceInput,
  UpdatePemNeatSourceResult,
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

function isActive(row: PemNeatRecord): boolean {
  return !row.deleted_at;
}

function isGeneratingLocked(row: PemNeatRecord): boolean {
  if (row.status !== "generating" || !row.generating_started_at) return false;
  const started = Date.parse(row.generating_started_at);
  if (!Number.isFinite(started)) return false;
  const lockMs = getPemNeatProviderTimeoutMs() + 30_000;
  return Date.now() - started < lockMs;
}

function emptyGenerationRow(
  id: string,
  pemNeatId: string,
  index: number,
  partial: Partial<PemNeatGenerationRow>,
): PemNeatGenerationRow {
  return {
    id,
    pem_neat_id: pemNeatId,
    generation_index: index,
    status: "failed",
    model_provider: null,
    model_name: null,
    neat_standard_version: PEM_NEAT_STANDARD_VERSION,
    structured_result: {},
    buildertrend_fields: {},
    analysis_metadata: {},
    error_message: null,
    error_code: null,
    finish_reason: null,
    transcript_hash: null,
    validation_issue_count: null,
    diagnostics_json: {},
    latency_ms: null,
    input_tokens: null,
    output_tokens: null,
    created_at: nowIso(),
    ...partial,
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
  updateSource(id: string, input: UpdatePemNeatSourceInput): Promise<UpdatePemNeatSourceResult>;
  softDelete(id: string, deletedBy: string): Promise<void>;
  markGenerating(id: string): Promise<PemNeatRecord>;
  saveGenerationSuccess(id: string, input: SaveGenerationSuccessInput): Promise<PemNeatRecord>;
  saveGenerationFailure(id: string, input: SaveGenerationFailureInput): Promise<PemNeatRecord>;
  listGenerations(id: string): Promise<PemNeatGenerationRow[]>;
  getGeneration(id: string, generationId: string): Promise<PemNeatGenerationRow | null>;
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
    analysis_stale: row.analysis_stale,
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
      current_generation_transcript_hash: null,
      meeting_outcome: null,
      qualification: null,
      neat_standard_version: PEM_NEAT_STANDARD_VERSION,
      generation_error: null,
      last_error_code: null,
      generating_started_at: null,
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
      analysis_stale: false,
      deleted_at: null,
      deleted_by: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    getMemoryState().neats.set(id, record);
    getMemoryState().generations.set(id, []);
    return structuredClone(record);
  }

  async get(id: string): Promise<PemNeatRecord | null> {
    const row = getMemoryState().neats.get(id);
    if (!row || !isActive(row)) return null;
    return structuredClone(row);
  }

  async list(options?: {
    query?: string;
    salespersonUserId?: string;
    status?: string;
    outcome?: string;
  }): Promise<PemNeatListItem[]> {
    let rows = Array.from(getMemoryState().neats.values()).filter(isActive);
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

  async updateSource(
    id: string,
    input: UpdatePemNeatSourceInput,
  ): Promise<UpdatePemNeatSourceResult> {
    const existing = getMemoryState().neats.get(id);
    if (!existing || !isActive(existing)) throw new NotFoundError("PEM NEAT not found");
    if (isGeneratingLocked(existing)) {
      throw new AppError("Generation already in progress.", {
        code: "PEM_NEAT_GENERATION_IN_PROGRESS",
        statusCode: 409,
      });
    }

    const nextTranscript = input.transcript;
    const nextHash = hashTranscript(nextTranscript);
    const transcriptChanged = nextHash !== existing.transcript_hash;
    const prospectNameChanged = existing.prospect_name.trim() !== input.prospectName.trim();
    const timestamp = nowIso();

    let status = existing.status;
    let analysisStale = existing.analysis_stale;
    const analysisMetadata = { ...existing.analysis_metadata };

    if (transcriptChanged && existing.generated_at) {
      status = "needs_regeneration";
      analysisStale = true;
      analysisMetadata.transcriptUpdatedAt = timestamp;
      analysisMetadata.staleReason = "transcript_changed";
    } else if (prospectNameChanged && existing.generated_at) {
      analysisStale = true;
      analysisMetadata.emailMayBeStale = true;
      analysisMetadata.staleReason = analysisMetadata.staleReason ?? "prospect_name_changed";
    }

    const updated: PemNeatRecord = {
      ...existing,
      prospect_name: input.prospectName.trim(),
      salesperson_user_id: input.salespersonUserId,
      salesperson_display_name: input.salespersonDisplayName.trim(),
      meeting_date: input.meetingDate ?? null,
      transcript: nextTranscript,
      transcript_hash: nextHash,
      transcript_char_count: nextTranscript.length,
      status,
      analysis_stale: analysisStale,
      analysis_metadata: analysisMetadata,
      updated_at: timestamp,
    };
    getMemoryState().neats.set(id, updated);
    return {
      record: structuredClone(updated),
      transcriptChanged,
      prospectNameChanged,
    };
  }

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const existing = getMemoryState().neats.get(id);
    if (!existing || !isActive(existing)) throw new NotFoundError("PEM NEAT not found");
    if (isGeneratingLocked(existing)) {
      throw new AppError("Cannot delete while generation is in progress.", {
        code: "PEM_NEAT_GENERATION_IN_PROGRESS",
        statusCode: 409,
      });
    }
    getMemoryState().neats.set(id, {
      ...existing,
      deleted_at: nowIso(),
      deleted_by: deletedBy,
      updated_at: nowIso(),
    });
  }

  async markGenerating(id: string): Promise<PemNeatRecord> {
    const existing = getMemoryState().neats.get(id);
    if (!existing || !isActive(existing)) throw new NotFoundError("PEM NEAT not found");
    if (isGeneratingLocked(existing)) {
      throw new AppError("Generation already in progress.", {
        code: "PEM_NEAT_GENERATION_IN_PROGRESS",
        statusCode: 409,
      });
    }
    const updated: PemNeatRecord = {
      ...existing,
      status: "generating",
      generation_error: null,
      last_error_code: null,
      generating_started_at: nowIso(),
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
    if (!existing || !isActive(existing)) throw new NotFoundError("PEM NEAT not found");
    const timestamp = nowIso();
    const gens = getMemoryState().generations.get(id) ?? [];
    const generationIndex = gens.length + 1;
    const transcriptHash = input.transcriptHash ?? existing.transcript_hash;
    const genRow = emptyGenerationRow(randomUUID(), id, generationIndex, {
      status: "completed",
      model_provider: input.modelProvider,
      model_name: input.modelName,
      neat_standard_version: input.neatStandardVersion,
      structured_result: input.structuredResult,
      buildertrend_fields: input.buildertrendFields,
      analysis_metadata: input.analysisMetadata,
      transcript_hash: transcriptHash,
      finish_reason: input.finishReason ?? null,
      diagnostics_json: input.diagnostics ?? {},
      latency_ms: input.latencyMs,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      created_at: timestamp,
    });
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
      last_error_code: null,
      generating_started_at: null,
      analysis_stale: false,
      current_generation_transcript_hash: transcriptHash,
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
    if (!existing || !isActive(existing)) throw new NotFoundError("PEM NEAT not found");
    const timestamp = nowIso();
    const gens = getMemoryState().generations.get(id) ?? [];
    gens.push(
      emptyGenerationRow(randomUUID(), id, gens.length + 1, {
        status: "failed",
        model_provider: input.modelProvider ?? null,
        model_name: input.modelName ?? null,
        neat_standard_version: existing.neat_standard_version,
        error_message: input.errorMessage,
        error_code: input.errorCode ?? null,
        finish_reason: input.finishReason ?? null,
        transcript_hash: input.transcriptHash ?? existing.transcript_hash,
        validation_issue_count: input.validationIssueCount ?? null,
        diagnostics_json: input.diagnostics ?? {},
        latency_ms: input.latencyMs ?? null,
        created_at: timestamp,
      }),
    );
    getMemoryState().generations.set(id, gens);

    // Preserve last successful structured result; restore needs_regeneration if stale.
    let status: PemNeatRecord["status"] = "failed";
    if (existing.generated_at) {
      status = existing.analysis_stale ? "needs_regeneration" : "completed";
    }

    const updated: PemNeatRecord = {
      ...existing,
      status,
      generation_error: input.errorMessage,
      last_error_code: input.errorCode ?? null,
      generating_started_at: null,
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

  async getGeneration(id: string, generationId: string): Promise<PemNeatGenerationRow | null> {
    const gens = getMemoryState().generations.get(id) ?? [];
    const found = gens.find((g) => g.id === generationId) ?? null;
    return found ? structuredClone(found) : null;
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
    current_generation_transcript_hash: row.current_generation_transcript_hash
      ? String(row.current_generation_transcript_hash)
      : null,
    meeting_outcome: (row.meeting_outcome as PemNeatRecord["meeting_outcome"]) ?? null,
    qualification: (row.qualification as PemNeatRecord["qualification"]) ?? null,
    neat_standard_version: String(row.neat_standard_version ?? PEM_NEAT_STANDARD_VERSION),
    generation_error: row.generation_error ? String(row.generation_error) : null,
    last_error_code: row.last_error_code ? String(row.last_error_code) : null,
    generating_started_at: row.generating_started_at ? String(row.generating_started_at) : null,
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
    analysis_stale: Boolean(row.analysis_stale),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
    deleted_by: row.deleted_by ? String(row.deleted_by) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapGenerationRow(row: Record<string, unknown>): PemNeatGenerationRow {
  return {
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
    error_code: row.error_code ? String(row.error_code) : null,
    finish_reason: row.finish_reason ? String(row.finish_reason) : null,
    transcript_hash: row.transcript_hash ? String(row.transcript_hash) : null,
    validation_issue_count:
      row.validation_issue_count != null ? Number(row.validation_issue_count) : null,
    diagnostics_json: (row.diagnostics_json as Record<string, unknown>) ?? {},
    latency_ms: row.latency_ms != null ? Number(row.latency_ms) : null,
    input_tokens: row.input_tokens != null ? Number(row.input_tokens) : null,
    output_tokens: row.output_tokens != null ? Number(row.output_tokens) : null,
    created_at: String(row.created_at),
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
        analysis_stale: false,
      })
      .select("*")
      .single();
    if (error) throw pemNeatStoreError(error, "Unable to create PEM NEAT");
    return mapRow(data as Record<string, unknown>);
  }

  async get(id: string): Promise<PemNeatRecord | null> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neats")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
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
        "id, prospect_name, salesperson_user_id, salesperson_display_name, meeting_date, status, meeting_outcome, qualification, analysis_stale, created_at, updated_at, generated_at",
      )
      .is("deleted_at", null)
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

  async updateSource(
    id: string,
    input: UpdatePemNeatSourceInput,
  ): Promise<UpdatePemNeatSourceResult> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");
    if (isGeneratingLocked(existing)) {
      throw new AppError("Generation already in progress.", {
        code: "PEM_NEAT_GENERATION_IN_PROGRESS",
        statusCode: 409,
      });
    }

    const nextTranscript = input.transcript;
    const nextHash = hashTranscript(nextTranscript);
    const transcriptChanged = nextHash !== existing.transcript_hash;
    const prospectNameChanged = existing.prospect_name.trim() !== input.prospectName.trim();
    const timestamp = nowIso();

    let status = existing.status;
    let analysisStale = existing.analysis_stale;
    const analysisMetadata = { ...existing.analysis_metadata };

    if (transcriptChanged && existing.generated_at) {
      status = "needs_regeneration";
      analysisStale = true;
      analysisMetadata.transcriptUpdatedAt = timestamp;
      analysisMetadata.staleReason = "transcript_changed";
    } else if (prospectNameChanged && existing.generated_at) {
      analysisStale = true;
      analysisMetadata.emailMayBeStale = true;
      analysisMetadata.staleReason = analysisMetadata.staleReason ?? "prospect_name_changed";
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neats")
      .update({
        prospect_name: input.prospectName.trim(),
        salesperson_user_id: input.salespersonUserId,
        salesperson_display_name: input.salespersonDisplayName.trim(),
        meeting_date: input.meetingDate ?? null,
        transcript: nextTranscript,
        transcript_hash: nextHash,
        transcript_char_count: nextTranscript.length,
        status,
        analysis_stale: analysisStale,
        analysis_metadata: analysisMetadata,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();
    if (error) throw pemNeatStoreError(error, "Unable to update PEM NEAT");
    return {
      record: mapRow(data as Record<string, unknown>),
      transcriptChanged,
      prospectNameChanged,
    };
  }

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");
    if (isGeneratingLocked(existing)) {
      throw new AppError("Cannot delete while generation is in progress.", {
        code: "PEM_NEAT_GENERATION_IN_PROGRESS",
        statusCode: 409,
      });
    }
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("pem_neats")
      .update({
        deleted_at: nowIso(),
        deleted_by: deletedBy,
      })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw pemNeatStoreError(error, "Unable to delete PEM NEAT");
  }

  async markGenerating(id: string): Promise<PemNeatRecord> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError("PEM NEAT not found");
    if (isGeneratingLocked(existing)) {
      throw new AppError("Generation already in progress.", {
        code: "PEM_NEAT_GENERATION_IN_PROGRESS",
        statusCode: 409,
      });
    }
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neats")
      .update({
        status: "generating",
        generation_error: null,
        last_error_code: null,
        generating_started_at: nowIso(),
      })
      .eq("id", id)
      .is("deleted_at", null)
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
    const transcriptHash = input.transcriptHash ?? existing.transcript_hash;

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
      transcript_hash: transcriptHash,
      finish_reason: input.finishReason ?? null,
      diagnostics_json: input.diagnostics ?? {},
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
        last_error_code: null,
        generating_started_at: null,
        analysis_stale: false,
        current_generation_transcript_hash: transcriptHash,
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
      error_code: input.errorCode ?? null,
      finish_reason: input.finishReason ?? null,
      transcript_hash: input.transcriptHash ?? existing.transcript_hash,
      validation_issue_count: input.validationIssueCount ?? null,
      diagnostics_json: input.diagnostics ?? {},
      latency_ms: input.latencyMs ?? null,
    });

    let status: PemNeatRecord["status"] = "failed";
    if (existing.generated_at) {
      status = existing.analysis_stale ? "needs_regeneration" : "completed";
    }

    const { data, error } = await supabase
      .from("pem_neats")
      .update({
        status,
        generation_error: input.errorMessage,
        last_error_code: input.errorCode ?? null,
        generating_started_at: null,
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
    return (data ?? []).map((row) => mapGenerationRow(row as Record<string, unknown>));
  }

  async getGeneration(id: string, generationId: string): Promise<PemNeatGenerationRow | null> {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pem_neat_generations")
      .select("*")
      .eq("pem_neat_id", id)
      .eq("id", generationId)
      .maybeSingle();
    if (error) throw pemNeatStoreError(error);
    return data ? mapGenerationRow(data as Record<string, unknown>) : null;
  }
}

export function getPemNeatStore(): PemNeatStore {
  if (shouldUseMemoryPemNeatStore()) {
    return new MemoryPemNeatStore();
  }
  return new SupabasePemNeatStore();
}
