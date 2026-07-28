import type { Confidence, ReportStatus, SourceStatus, UserRole } from "./types";

export type {
  Confidence,
  ConflictSeverity,
  MatchMethod,
  ReportStatus,
  SourceStatus,
  SourceType,
  UserRole,
} from "./types";

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  department_id?: string | null;
  department_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportRow = {
  id: string;
  created_by: string;
  input_address: string;
  standardized_address: string | null;
  status: ReportStatus;
  jurisdiction_name: string | null;
  jurisdiction_type: string | null;
  county: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  apn: string | null;
  summary: string | null;
  report_version: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  attom_id?: string | null;
  rentcast_id?: string | null;
  fips?: string | null;
  mailing_locality?: string | null;
  zip_code?: string | null;
  property_profile_access_type?: string | null;
  property_profile_url?: string | null;
  property_profile_status_message?: string | null;
  research_diagnostics_json?: unknown;
  google_place_id?: string | null;
  address_line_1?: string | null;
  country_code?: string | null;
  normalized_apn?: string | null;
  parent_report_id?: string | null;
  refresh_reason?: string | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_generation_status?: string | null;
  ai_prompt_version?: string | null;
  ai_generated_at?: string | null;
  ai_input_hash?: string | null;
  maps_json?: unknown;
};

export type PropertyFactRow = {
  id: string;
  report_id: string;
  category: string;
  field_key: string;
  field_label: string;
  normalized_value_text: string | null;
  normalized_value_number: number | null;
  normalized_value_boolean: boolean | null;
  unit: string | null;
  preferred_source_name: string | null;
  preferred_source_url: string | null;
  confidence: Confidence;
  created_at: string;
  updated_at: string;
};

export type PropertySourceClaimRow = {
  id: string;
  report_id: string;
  field_key: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
  source_record_id: string | null;
  raw_value: string | null;
  normalized_value: string | null;
  match_method: string;
  confidence: Confidence;
  retrieved_at: string;
  source_updated_at: string | null;
  raw_response_json: unknown;
  match_score?: number | null;
  is_preferred?: boolean;
  created_at: string;
};

export type ReportConflictRow = {
  id: string;
  report_id: string;
  field_key: string;
  field_label: string;
  severity: string;
  description: string;
  values_json: unknown;
  recommended_resolution: string;
  created_at: string;
};

export type ReportSourceRow = {
  id: string;
  report_id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
  status: SourceStatus;
  retrieved_at: string | null;
  source_updated_at: string | null;
  response_time_ms: number | null;
  status_message: string | null;
  endpoint_name?: string | null;
  http_status?: number | null;
  created_at: string;
};

export type ParcelGeometryRow = {
  id: string;
  report_id: string;
  geometry_geojson: unknown;
  centroid_latitude: number | null;
  centroid_longitude: number | null;
  calculated_area_sq_ft: number | null;
  source_name: string | null;
  source_url: string | null;
  created_at: string;
};

export type SiteObservationRow = {
  id: string;
  report_id: string;
  observation_type: string;
  title: string;
  description: string;
  confidence: Confidence;
  source_name: string | null;
  source_url: string | null;
  created_at: string;
};

export type PemPreparationRow = {
  id: string;
  report_id: string;
  overview: string;
  property_findings: unknown;
  property_questions: unknown;
  verify_during_pem: unknown;
  verify_during_feasibility: unknown;
  verify_through_title_or_survey: unknown;
  verify_with_planning: unknown;
  created_at: string;
  updated_at: string;
};

export type ConnectorHealthCheckRow = {
  id: string;
  connector_key: string;
  source_name: string;
  endpoint_url: string | null;
  status: SourceStatus;
  response_time_ms: number | null;
  expected_schema_valid: boolean | null;
  message: string | null;
  checked_at: string;
};

export type FullReport = ReportRow & {
  creator?: Profile | null;
  facts: PropertyFactRow[];
  claims: PropertySourceClaimRow[];
  conflicts: ReportConflictRow[];
  sources: ReportSourceRow[];
  parcelGeometry: ParcelGeometryRow | null;
  siteObservations: SiteObservationRow[];
  pemPreparation: PemPreparationRow | null;
};

export type ReportListItem = ReportRow & {
  creator_name?: string | null;
};

export type ResearchProgress = {
  reportId: string;
  status: ReportStatus;
  stageIndex: number;
  stageLabel: string;
  errorMessage: string | null;
};
