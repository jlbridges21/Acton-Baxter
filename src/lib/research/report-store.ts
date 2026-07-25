import { randomUUID } from "node:crypto";
import type {
  FullReport,
  Profile,
  ReportListItem,
  ReportRow,
  ConnectorHealthCheckRow,
} from "./db-types";
import type { NormalizedResearchResult } from "./schemas";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { getMockSourceHealth } from "./source-health";

export type CreateReportInput = {
  createdBy: string;
  inputAddress: string;
  standardizedAddress: string;
  reportVersion: string;
  googlePlaceId?: string | null;
  addressLine1?: string | null;
  mailingLocality?: string | null;
  zipCode?: string | null;
  county?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  parentReportId?: string | null;
  refreshReason?: string | null;
};

export interface ReportStore {
  createReport(input: CreateReportInput): Promise<ReportRow>;
  getReport(reportId: string): Promise<ReportRow | null>;
  getFullReport(reportId: string): Promise<FullReport | null>;
  listReports(options?: { query?: string; status?: string }): Promise<ReportListItem[]>;
  updateReportStatus(
    reportId: string,
    status: ReportRow["status"],
    extras?: {
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): Promise<void>;
  clearResearchChildren(reportId: string): Promise<void>;
  saveResearchResult(reportId: string, result: NormalizedResearchResult): Promise<void>;
  getSourceHealth(): Promise<ConnectorHealthCheckRow[]>;
  ensureProfile(profile: Profile): Promise<Profile>;
  getProfile(userId: string): Promise<Profile | null>;
  listProfiles(): Promise<Profile[]>;
  updateProfileRole(userId: string, role: Profile["role"]): Promise<Profile>;
}

type MemoryState = {
  profiles: Map<string, Profile>;
  reports: Map<string, FullReport>;
};

const globalMemory = globalThis as typeof globalThis & {
  __actonReportMemory?: MemoryState;
};

function getMemoryState(): MemoryState {
  if (!globalMemory.__actonReportMemory) {
    globalMemory.__actonReportMemory = {
      profiles: new Map(),
      reports: new Map(),
    };
  }
  return globalMemory.__actonReportMemory;
}

function nowIso() {
  return new Date().toISOString();
}

class MemoryReportStore implements ReportStore {
  async ensureProfile(profile: Profile): Promise<Profile> {
    const state = getMemoryState();
    state.profiles.set(profile.id, profile);
    return profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    return getMemoryState().profiles.get(userId) ?? null;
  }

  async listProfiles(): Promise<Profile[]> {
    return Array.from(getMemoryState().profiles.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    );
  }

  async updateProfileRole(userId: string, role: Profile["role"]): Promise<Profile> {
    const existing = getMemoryState().profiles.get(userId);
    if (!existing) {
      throw new Error("Profile not found");
    }
    const updated: Profile = { ...existing, role, updated_at: nowIso() };
    getMemoryState().profiles.set(userId, updated);
    return updated;
  }

  async createReport(input: CreateReportInput): Promise<ReportRow> {
    const id = randomUUID();
    const timestamp = nowIso();
    const report: FullReport = {
      id,
      created_by: input.createdBy,
      input_address: input.inputAddress,
      standardized_address: input.standardizedAddress,
      status: "queued",
      jurisdiction_name: null,
      jurisdiction_type: null,
      county: input.county ?? null,
      state: null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      apn: null,
      summary: null,
      report_version: input.reportVersion,
      error_message: null,
      started_at: null,
      completed_at: null,
      created_at: timestamp,
      updated_at: timestamp,
      google_place_id: input.googlePlaceId ?? null,
      address_line_1: input.addressLine1 ?? null,
      mailing_locality: input.mailingLocality ?? null,
      zip_code: input.zipCode ?? null,
      country_code: input.countryCode ?? null,
      parent_report_id: input.parentReportId ?? null,
      refresh_reason: input.refreshReason ?? null,
      maps_json: null,
      facts: [],
      claims: [],
      conflicts: [],
      sources: [],
      parcelGeometry: null,
      siteObservations: [],
      pemPreparation: null,
      creator: getMemoryState().profiles.get(input.createdBy) ?? null,
    };
    getMemoryState().reports.set(id, report);
    return report;
  }

  async getReport(reportId: string): Promise<ReportRow | null> {
    return getMemoryState().reports.get(reportId) ?? null;
  }

  async getFullReport(reportId: string): Promise<FullReport | null> {
    const report = getMemoryState().reports.get(reportId);
    if (!report) return null;
    return {
      ...report,
      creator: getMemoryState().profiles.get(report.created_by) ?? report.creator ?? null,
    };
  }

  async listReports(options?: { query?: string; status?: string }): Promise<ReportListItem[]> {
    let reports = [...getMemoryState().reports.values()];
    if (options?.status && options.status !== "all") {
      reports = reports.filter((report) => report.status === options.status);
    }
    if (options?.query) {
      const q = options.query.toLowerCase();
      const qApn = options.query.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      reports = reports.filter(
        (report) =>
          report.input_address.toLowerCase().includes(q) ||
          report.standardized_address?.toLowerCase().includes(q) ||
          report.apn?.toLowerCase().includes(q) ||
          (qApn.length > 0 && report.normalized_apn?.includes(qApn)),
      );
    }
    return reports
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((report) => ({
        ...report,
        creator_name: getMemoryState().profiles.get(report.created_by)?.full_name ?? null,
      }));
  }

  async updateReportStatus(
    reportId: string,
    status: ReportRow["status"],
    extras?: {
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): Promise<void> {
    const report = getMemoryState().reports.get(reportId);
    if (!report) return;
    report.status = status;
    report.updated_at = nowIso();
    if (extras?.errorMessage !== undefined) report.error_message = extras.errorMessage;
    if (extras?.startedAt !== undefined) report.started_at = extras.startedAt;
    if (extras?.completedAt !== undefined) report.completed_at = extras.completedAt;
    getMemoryState().reports.set(reportId, report);
  }

  async clearResearchChildren(reportId: string): Promise<void> {
    const report = getMemoryState().reports.get(reportId);
    if (!report) return;
    report.facts = [];
    report.claims = [];
    report.conflicts = [];
    report.sources = [];
    report.parcelGeometry = null;
    report.siteObservations = [];
    report.pemPreparation = null;
    report.summary = null;
    report.apn = null;
    report.jurisdiction_name = null;
    report.jurisdiction_type = null;
    report.county = null;
    report.state = null;
    report.latitude = null;
    report.longitude = null;
    report.standardized_address = report.input_address;
    report.updated_at = nowIso();
    getMemoryState().reports.set(reportId, report);
  }

  async saveResearchResult(reportId: string, result: NormalizedResearchResult): Promise<void> {
    const report = getMemoryState().reports.get(reportId);
    if (!report) return;
    const timestamp = nowIso();

    report.standardized_address = result.identity.standardizedAddress;
    report.status = "complete";
    report.jurisdiction_name = result.identity.jurisdiction;
    report.jurisdiction_type = result.identity.jurisdictionType ?? null;
    report.county = result.identity.county;
    report.state = result.identity.state;
    report.latitude = result.identity.latitude;
    report.longitude = result.identity.longitude;
    report.apn = result.identity.apn;
    report.normalized_apn = result.identity.apn
      ? result.identity.apn.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
      : null;
    report.summary = result.summary;
    report.attom_id = result.identity.attomId ?? null;
    report.rentcast_id = result.identity.rentcastId ?? null;
    report.fips = result.identity.fips ?? null;
    report.mailing_locality = result.identity.mailingLocality ?? report.mailing_locality ?? null;
    report.zip_code = result.identity.zipCode ?? report.zip_code ?? null;
    report.property_profile_access_type = result.propertyProfile?.accessType ?? null;
    report.property_profile_url = result.propertyProfile?.url ?? null;
    report.property_profile_status_message = result.propertyProfile?.statusMessage ?? null;
    report.research_diagnostics_json = result.diagnostics ?? null;
    report.ai_provider = result.aiGeneration?.provider ?? null;
    report.ai_model = result.aiGeneration?.model ?? null;
    report.ai_generation_status = result.aiGeneration?.status ?? null;
    report.ai_prompt_version = result.aiGeneration?.promptVersion ?? null;
    report.ai_generated_at = result.aiGeneration?.generatedAt ?? null;
    report.ai_input_hash = result.aiGeneration?.inputHash ?? null;
    report.maps_json = result.maps ?? null;
    report.error_message = null;
    report.completed_at = timestamp;
    report.updated_at = timestamp;

    report.facts = result.facts.map((fact) => ({
      id: randomUUID(),
      report_id: reportId,
      category: fact.category,
      field_key: fact.fieldKey,
      field_label: fact.fieldLabel,
      normalized_value_text: fact.normalizedValueText,
      normalized_value_number: fact.normalizedValueNumber,
      normalized_value_boolean: fact.normalizedValueBoolean,
      unit: fact.unit ?? null,
      preferred_source_name: fact.preferredSourceName ?? null,
      preferred_source_url: fact.preferredSourceUrl ?? null,
      confidence: fact.confidence,
      created_at: timestamp,
      updated_at: timestamp,
    }));

    report.claims = result.claims.map((claim) => ({
      id: randomUUID(),
      report_id: reportId,
      field_key: claim.fieldKey,
      source_name: claim.sourceName,
      source_type: claim.sourceType,
      source_url: claim.sourceUrl ?? null,
      source_record_id: claim.sourceRecordId ?? null,
      raw_value: claim.rawValue,
      normalized_value: claim.normalizedValue,
      match_method: claim.matchMethod,
      confidence: claim.confidence,
      retrieved_at: claim.retrievedAt,
      source_updated_at: claim.sourceUpdatedAt ?? null,
      raw_response_json: claim.rawResponseJson ?? null,
      match_score: claim.matchScore ?? null,
      is_preferred: claim.isPreferred ?? false,
      created_at: timestamp,
    }));

    report.conflicts = result.conflicts.map((conflict) => ({
      id: randomUUID(),
      report_id: reportId,
      field_key: conflict.fieldKey,
      field_label: conflict.fieldLabel,
      severity: conflict.severity,
      description: conflict.description,
      values_json: conflict.values,
      recommended_resolution: conflict.recommendedResolution,
      created_at: timestamp,
    }));

    report.sources = result.sources.map((source) => ({
      id: randomUUID(),
      report_id: reportId,
      source_name: source.sourceName,
      source_type: source.sourceType,
      source_url: source.sourceUrl ?? null,
      status: source.status,
      retrieved_at: source.retrievedAt ?? null,
      source_updated_at: source.sourceUpdatedAt ?? null,
      response_time_ms: source.responseTimeMs ?? null,
      status_message: source.statusMessage ?? null,
      endpoint_name: source.endpointName ?? null,
      http_status: source.httpStatus ?? null,
      created_at: timestamp,
    }));

    report.parcelGeometry = result.parcelGeometry
      ? {
          id: randomUUID(),
          report_id: reportId,
          geometry_geojson: result.parcelGeometry.geometryGeojson,
          centroid_latitude: result.parcelGeometry.centroidLatitude,
          centroid_longitude: result.parcelGeometry.centroidLongitude,
          calculated_area_sq_ft: result.parcelGeometry.calculatedAreaSqFt,
          source_name: result.parcelGeometry.sourceName ?? null,
          source_url: result.parcelGeometry.sourceUrl ?? null,
          created_at: timestamp,
        }
      : null;

    report.siteObservations = result.siteObservations.map((obs) => ({
      id: randomUUID(),
      report_id: reportId,
      observation_type: obs.observationType,
      title: obs.title,
      description: obs.description,
      confidence: obs.confidence,
      source_name: obs.sourceName ?? null,
      source_url: obs.sourceUrl ?? null,
      created_at: timestamp,
    }));

    report.pemPreparation = {
      id: randomUUID(),
      report_id: reportId,
      overview: result.pemPreparation.overview,
      property_findings: result.pemPreparation.propertyFindings,
      property_questions: result.pemPreparation.propertyQuestions,
      verify_during_pem: result.pemPreparation.verifyDuringPem,
      verify_during_feasibility: result.pemPreparation.verifyDuringFeasibility,
      verify_through_title_or_survey: result.pemPreparation.verifyThroughTitleOrSurvey,
      verify_with_planning: result.pemPreparation.verifyWithPlanning,
      created_at: timestamp,
      updated_at: timestamp,
    };

    getMemoryState().reports.set(reportId, report);
  }

  async getSourceHealth(): Promise<ConnectorHealthCheckRow[]> {
    return getMockSourceHealth().map((item) => ({
      id: randomUUID(),
      connector_key: item.provider,
      source_name: item.sourceName,
      endpoint_url: item.endpointUrl,
      status: item.status,
      response_time_ms: item.responseTimeMs,
      expected_schema_valid: item.schemaValid,
      message: item.message,
      checked_at: item.lastChecked,
    }));
  }
}

class SupabaseReportStore implements ReportStore {
  private client() {
    return createServiceClient();
  }

  async ensureProfile(profile: Profile): Promise<Profile> {
    const supabase = this.client();
    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: profile.id,
          full_name: profile.full_name,
          role: profile.role,
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return data as Profile;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const supabase = this.client();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data as Profile | null) ?? null;
  }

  async listProfiles(): Promise<Profile[]> {
    const supabase = this.client();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as Profile[]) ?? [];
  }

  async updateProfileRole(userId: string, role: Profile["role"]): Promise<Profile> {
    const supabase = this.client();
    // Prefer SECURITY DEFINER RPC so role changes work even when JWT context
    // is present and RLS/triggers would otherwise block direct updates.
    const { data: rpcData, error: rpcError } = await supabase.rpc("admin_set_profile_role", {
      target_user_id: userId,
      new_role: role,
    });

    if (!rpcError && rpcData) {
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (row) return row as Profile;
    }

    // Fallback for environments that have not applied migration 014 yet.
    if (rpcError) {
      const message = rpcError.message ?? "";
      const missingFn =
        rpcError.code === "PGRST202" ||
        rpcError.code === "42883" ||
        message.toLowerCase().includes("admin_set_profile_role") ||
        message.toLowerCase().includes("could not find the function");
      if (!missingFn) {
        throw Object.assign(new Error(message || "Unable to update role"), {
          code: rpcError.code ?? "PROFILE_ROLE_UPDATE_FAILED",
          statusCode: 400,
          expose: true,
        });
      }
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", userId)
      .select("*")
      .single();
    if (error) {
      throw Object.assign(new Error(error.message || "Unable to update role"), {
        code: error.code ?? "PROFILE_ROLE_UPDATE_FAILED",
        statusCode: 400,
        expose: true,
      });
    }
    return data as Profile;
  }

  async createReport(input: CreateReportInput): Promise<ReportRow> {
    const supabase = this.client();
    const { data, error } = await supabase
      .from("reports")
      .insert({
        created_by: input.createdBy,
        input_address: input.inputAddress,
        standardized_address: input.standardizedAddress,
        status: "queued",
        report_version: input.reportVersion,
        google_place_id: input.googlePlaceId ?? null,
        address_line_1: input.addressLine1 ?? null,
        mailing_locality: input.mailingLocality ?? null,
        zip_code: input.zipCode ?? null,
        country_code: input.countryCode ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        parent_report_id: input.parentReportId ?? null,
        refresh_reason: input.refreshReason ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ReportRow;
  }

  async getReport(reportId: string): Promise<ReportRow | null> {
    const supabase = this.client();
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (error) throw error;
    return (data as ReportRow | null) ?? null;
  }

  async getFullReport(reportId: string): Promise<FullReport | null> {
    const supabase = this.client();
    const { data: report, error } = await supabase
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (error) throw error;
    if (!report) return null;

    const [
      facts,
      claims,
      conflicts,
      sources,
      parcelGeometry,
      siteObservations,
      pemPreparation,
      creator,
    ] = await Promise.all([
      supabase.from("property_facts").select("*").eq("report_id", reportId),
      supabase.from("property_source_claims").select("*").eq("report_id", reportId),
      supabase.from("report_conflicts").select("*").eq("report_id", reportId),
      supabase.from("report_sources").select("*").eq("report_id", reportId),
      supabase.from("parcel_geometry").select("*").eq("report_id", reportId).maybeSingle(),
      supabase.from("site_observations").select("*").eq("report_id", reportId),
      supabase.from("pem_preparations").select("*").eq("report_id", reportId).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", report.created_by).maybeSingle(),
    ]);

    for (const result of [facts, claims, conflicts, sources, siteObservations]) {
      if (result.error) throw result.error;
    }
    if (parcelGeometry.error) throw parcelGeometry.error;
    if (pemPreparation.error) throw pemPreparation.error;
    if (creator.error) throw creator.error;

    return {
      ...(report as ReportRow),
      creator: (creator.data as Profile | null) ?? null,
      facts: facts.data ?? [],
      claims: claims.data ?? [],
      conflicts: conflicts.data ?? [],
      sources: sources.data ?? [],
      parcelGeometry: parcelGeometry.data ?? null,
      siteObservations: siteObservations.data ?? [],
      pemPreparation: pemPreparation.data ?? null,
    };
  }

  async listReports(options?: { query?: string; status?: string }): Promise<ReportListItem[]> {
    const supabase = this.client();
    let query = supabase
      .from("reports")
      .select("*, profiles!reports_created_by_fkey(full_name)")
      .order("created_at", { ascending: false });

    if (options?.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }

    const { data, error } = await query;
    if (error) throw error;

    let rows = (data ?? []) as Array<ReportRow & { profiles?: { full_name: string } | null }>;
    if (options?.query) {
      const q = options.query.toLowerCase();
      const qApn = options.query.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      rows = rows.filter(
        (report) =>
          report.input_address.toLowerCase().includes(q) ||
          report.standardized_address?.toLowerCase().includes(q) ||
          report.apn?.toLowerCase().includes(q) ||
          (qApn.length > 0 && (report.normalized_apn ?? "").includes(qApn)),
      );
    }

    return rows.map((report) => ({
      ...report,
      creator_name: report.profiles?.full_name ?? null,
    }));
  }

  async updateReportStatus(
    reportId: string,
    status: ReportRow["status"],
    extras?: {
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): Promise<void> {
    const supabase = this.client();
    const payload: Record<string, unknown> = { status };
    if (extras?.errorMessage !== undefined) payload.error_message = extras.errorMessage;
    if (extras?.startedAt !== undefined) payload.started_at = extras.startedAt;
    if (extras?.completedAt !== undefined) payload.completed_at = extras.completedAt;
    const { error } = await supabase.from("reports").update(payload).eq("id", reportId);
    if (error) throw error;
  }

  async clearResearchChildren(reportId: string): Promise<void> {
    const supabase = this.client();
    const tables = [
      "property_facts",
      "property_source_claims",
      "report_conflicts",
      "report_sources",
      "parcel_geometry",
      "site_observations",
      "pem_preparations",
    ] as const;

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().eq("report_id", reportId);
      if (error) throw error;
    }
  }

  async saveResearchResult(reportId: string, result: NormalizedResearchResult): Promise<void> {
    const supabase = this.client();

    const { error: reportError } = await supabase
      .from("reports")
      .update({
        status: "complete",
        standardized_address: result.identity.standardizedAddress,
        jurisdiction_name: result.identity.jurisdiction,
        jurisdiction_type: result.identity.jurisdictionType ?? null,
        county: result.identity.county,
        state: result.identity.state,
        latitude: result.identity.latitude,
        longitude: result.identity.longitude,
        apn: result.identity.apn,
        normalized_apn: result.identity.apn
          ? result.identity.apn.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
          : null,
        summary: result.summary,
        attom_id: result.identity.attomId ?? null,
        rentcast_id: result.identity.rentcastId ?? null,
        fips: result.identity.fips ?? null,
        mailing_locality: result.identity.mailingLocality ?? null,
        zip_code: result.identity.zipCode ?? null,
        property_profile_access_type: result.propertyProfile?.accessType ?? null,
        property_profile_url: result.propertyProfile?.url ?? null,
        property_profile_status_message: result.propertyProfile?.statusMessage ?? null,
        research_diagnostics_json: result.diagnostics ?? null,
        ai_provider: result.aiGeneration?.provider ?? null,
        ai_model: result.aiGeneration?.model ?? null,
        ai_generation_status: result.aiGeneration?.status ?? null,
        ai_prompt_version: result.aiGeneration?.promptVersion ?? null,
        ai_generated_at: result.aiGeneration?.generatedAt ?? null,
        ai_input_hash: result.aiGeneration?.inputHash ?? null,
        maps_json: result.maps ?? null,
        error_message: null,
        completed_at: nowIso(),
      })
      .eq("id", reportId);
    if (reportError) throw reportError;

    const { error: factsError } = await supabase.from("property_facts").insert(
      result.facts.map((fact) => ({
        report_id: reportId,
        category: fact.category,
        field_key: fact.fieldKey,
        field_label: fact.fieldLabel,
        normalized_value_text: fact.normalizedValueText,
        normalized_value_number: fact.normalizedValueNumber,
        normalized_value_boolean: fact.normalizedValueBoolean,
        unit: fact.unit ?? null,
        preferred_source_name: fact.preferredSourceName ?? null,
        preferred_source_url: fact.preferredSourceUrl ?? null,
        confidence: fact.confidence,
      })),
    );
    if (factsError) throw factsError;

    const { error: claimsError } = await supabase.from("property_source_claims").insert(
      result.claims.map((claim) => ({
        report_id: reportId,
        field_key: claim.fieldKey,
        source_name: claim.sourceName,
        source_type: claim.sourceType,
        source_url: claim.sourceUrl ?? null,
        source_record_id: claim.sourceRecordId ?? null,
        raw_value: claim.rawValue,
        normalized_value: claim.normalizedValue,
        match_method: claim.matchMethod,
        confidence: claim.confidence,
        retrieved_at: claim.retrievedAt,
        source_updated_at: claim.sourceUpdatedAt ?? null,
        raw_response_json: claim.rawResponseJson ?? null,
        match_score: claim.matchScore ?? null,
        is_preferred: claim.isPreferred ?? false,
      })),
    );
    if (claimsError) throw claimsError;

    if (result.conflicts.length > 0) {
      const { error: conflictsError } = await supabase.from("report_conflicts").insert(
        result.conflicts.map((conflict) => ({
          report_id: reportId,
          field_key: conflict.fieldKey,
          field_label: conflict.fieldLabel,
          severity: conflict.severity,
          description: conflict.description,
          values_json: conflict.values,
          recommended_resolution: conflict.recommendedResolution,
        })),
      );
      if (conflictsError) throw conflictsError;
    }

    const { error: sourcesError } = await supabase.from("report_sources").insert(
      result.sources.map((source) => ({
        report_id: reportId,
        source_name: source.sourceName,
        source_type: source.sourceType,
        source_url: source.sourceUrl ?? null,
        status: source.status,
        retrieved_at: source.retrievedAt ?? null,
        source_updated_at: source.sourceUpdatedAt ?? null,
        response_time_ms: source.responseTimeMs ?? null,
        status_message: source.statusMessage ?? null,
        endpoint_name: source.endpointName ?? null,
        http_status: source.httpStatus ?? null,
      })),
    );
    if (sourcesError) throw sourcesError;

    if (result.parcelGeometry) {
      const { error: geometryError } = await supabase.from("parcel_geometry").insert({
        report_id: reportId,
        geometry_geojson: result.parcelGeometry.geometryGeojson,
        centroid_latitude: result.parcelGeometry.centroidLatitude,
        centroid_longitude: result.parcelGeometry.centroidLongitude,
        calculated_area_sq_ft: result.parcelGeometry.calculatedAreaSqFt,
        source_name: result.parcelGeometry.sourceName ?? null,
        source_url: result.parcelGeometry.sourceUrl ?? null,
      });
      if (geometryError) throw geometryError;
    }

    if (result.siteObservations.length > 0) {
      const { error: observationsError } = await supabase.from("site_observations").insert(
        result.siteObservations.map((obs) => ({
          report_id: reportId,
          observation_type: obs.observationType,
          title: obs.title,
          description: obs.description,
          confidence: obs.confidence,
          source_name: obs.sourceName ?? null,
          source_url: obs.sourceUrl ?? null,
        })),
      );
      if (observationsError) throw observationsError;
    }

    const { error: pemError } = await supabase.from("pem_preparations").insert({
      report_id: reportId,
      overview: result.pemPreparation.overview,
      property_findings: result.pemPreparation.propertyFindings,
      property_questions: result.pemPreparation.propertyQuestions,
      verify_during_pem: result.pemPreparation.verifyDuringPem,
      verify_during_feasibility: result.pemPreparation.verifyDuringFeasibility,
      verify_through_title_or_survey: result.pemPreparation.verifyThroughTitleOrSurvey,
      verify_with_planning: result.pemPreparation.verifyWithPlanning,
    });
    if (pemError) throw pemError;
  }

  async getSourceHealth(): Promise<ConnectorHealthCheckRow[]> {
    const supabase = this.client();
    const { data, error } = await supabase
      .from("connector_health_checks")
      .select("*")
      .order("checked_at", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      return new MemoryReportStore().getSourceHealth();
    }
    return data as ConnectorHealthCheckRow[];
  }
}

export function getReportStore(): ReportStore {
  const env = getEnv();
  const useMemory =
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-");

  if (useMemory) {
    return new MemoryReportStore();
  }
  return new SupabaseReportStore();
}

export function resetMemoryStoreForTests() {
  globalMemory.__actonReportMemory = {
    profiles: new Map(),
    reports: new Map(),
  };
}
