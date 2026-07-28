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
  analysis_stale: boolean;
  created_at: string;
  updated_at: string;
  generated_at: string | null;
};

export type PemNeatRecord = PemNeatListItem & {
  created_by: string | null;
  transcript: string;
  transcript_hash: string | null;
  transcript_char_count: number;
  current_generation_transcript_hash: string | null;
  neat_standard_version: string;
  generation_error: string | null;
  last_error_code: string | null;
  generating_started_at: string | null;
  regenerated_at: string | null;
  model_provider: string | null;
  model_name: string | null;
  generation_latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  structured_result: PemNeatStructuredResult | Record<string, unknown>;
  buildertrend_fields: BuildertrendFields | Record<string, unknown>;
  analysis_metadata: Record<string, unknown>;
  deleted_at: string | null;
  deleted_by: string | null;
  generation_stage?: string | null;
  generation_trace_json?: Record<string, unknown>;
  stage_outputs_json?: Record<string, unknown>;
  generation_job_id?: string | null;
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
  error_code: string | null;
  finish_reason: string | null;
  transcript_hash: string | null;
  validation_issue_count: number | null;
  diagnostics_json: Record<string, unknown>;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  stage_outputs_json?: Record<string, unknown>;
  generation_trace_json?: Record<string, unknown>;
  failed_stage?: string | null;
};

export type CreatePemNeatRecordInput = {
  prospectName: string;
  salespersonUserId: string;
  salespersonDisplayName: string;
  meetingDate?: string | null;
  transcript: string;
  createdBy: string;
};

export type UpdatePemNeatSourceInput = {
  prospectName: string;
  salespersonUserId: string;
  salespersonDisplayName: string;
  meetingDate?: string | null;
  transcript: string;
  updatedBy: string;
};

export type UpdatePemNeatSourceResult = {
  record: PemNeatRecord;
  transcriptChanged: boolean;
  prospectNameChanged: boolean;
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
  transcriptHash?: string | null;
  diagnostics?: Record<string, unknown>;
  finishReason?: string | null;
  stageOutputs?: Record<string, unknown> | null;
  generationTrace?: Record<string, unknown> | null;
};

export type SaveGenerationFailureInput = {
  errorMessage: string;
  errorCode?: string | null;
  modelProvider?: string | null;
  modelName?: string | null;
  latencyMs?: number | null;
  finishReason?: string | null;
  transcriptHash?: string | null;
  validationIssueCount?: number | null;
  diagnostics?: Record<string, unknown>;
  stageOutputs?: Record<string, unknown> | null;
  generationTrace?: Record<string, unknown> | null;
  failedStage?: string | null;
};

export type UpdateGenerationProgressInput = {
  stage: string;
  trace?: Record<string, unknown> | null;
  stageOutputs?: Record<string, unknown> | null;
};
