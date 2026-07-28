import type { MeetingOutcome, PemNeatStatus, QualificationLevel } from "./constants";
import type { BuildertrendFields, PemNeatStructuredResult } from "./schemas";

export type PemNeatListItem = {
  id: string;
  prospect_name: string;
  salesperson_user_id: string | null;
  salesperson_display_name: string;
  meeting_date: string | null;
  status: PemNeatStatus;
  meeting_outcome: MeetingOutcome | null;
  qualification: QualificationLevel | null;
  created_at: string;
  updated_at: string;
  generated_at: string | null;
};

export type PemNeatRecord = PemNeatListItem & {
  created_by: string | null;
  transcript: string;
  transcript_hash: string | null;
  transcript_char_count: number;
  neat_standard_version: string;
  generation_error: string | null;
  regenerated_at: string | null;
  model_provider: string | null;
  model_name: string | null;
  generation_latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  structured_result: PemNeatStructuredResult | Record<string, unknown>;
  buildertrend_fields: BuildertrendFields | Record<string, unknown>;
  analysis_metadata: Record<string, unknown>;
};

export type PemNeatGenerationRow = {
  id: string;
  pem_neat_id: string;
  generation_index: number;
  status: "completed" | "failed";
  model_provider: string | null;
  model_name: string | null;
  neat_standard_version: string;
  structured_result: PemNeatStructuredResult | Record<string, unknown>;
  buildertrend_fields: BuildertrendFields | Record<string, unknown>;
  analysis_metadata: Record<string, unknown>;
  error_message: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

export type CreatePemNeatRecordInput = {
  prospectName: string;
  salespersonUserId: string;
  salespersonDisplayName: string;
  meetingDate?: string | null;
  transcript: string;
  createdBy: string;
};

export type SaveGenerationSuccessInput = {
  structuredResult: PemNeatStructuredResult;
  buildertrendFields: BuildertrendFields;
  analysisMetadata: Record<string, unknown>;
  meetingOutcome: MeetingOutcome;
  qualification: QualificationLevel;
  modelProvider: string;
  modelName: string;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  neatStandardVersion: string;
};

export type SaveGenerationFailureInput = {
  errorMessage: string;
  modelProvider?: string | null;
  modelName?: string | null;
  latencyMs?: number | null;
};
