import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import type {
  FindingCandidate,
  MonitoringFinding,
  FindingFilters,
  SlackAlertRef,
  CheckKey,
} from "./types";

/**
 * Upsert a finding candidate.
 * - If dedupe_key exists: refresh last_detected_at if status is open/alerted/acknowledged
 * - If new: insert with status=open
 */
export async function upsertFindingCandidate(
  candidate: FindingCandidate,
): Promise<{ finding: MonitoringFinding; isNew: boolean }> {
  const supabase = createServiceClient();

  const existing = await supabase
    .from("monitoring_findings")
    .select("*")
    .eq("dedupe_key", candidate.dedupeKey)
    .single();

  const now = new Date().toISOString();

  if (existing.data) {
    const finding = existing.data;
    const isRefreshable = ["open", "alerted", "acknowledged"].includes(finding.status);

    if (isRefreshable) {
      const { data: updated, error } = await supabase
        .from("monitoring_findings")
        .update({
          last_detected_at: now,
          severity: candidate.severity,
          title: candidate.title,
          evidence_json: candidate.evidence,
          recommendation: candidate.recommendation || null,
        })
        .eq("id", finding.id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to refresh finding: ${error.message}`);
      }

      return { finding: mapFinding(updated), isNew: false };
    }

    return { finding: mapFinding(finding), isNew: false };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("monitoring_findings")
    .insert({
      check_key: candidate.checkKey,
      dedupe_key: candidate.dedupeKey,
      severity: candidate.severity,
      entity_type: candidate.entityType,
      entity_id: candidate.entityId || null,
      contact_id: candidate.contactId || null,
      opportunity_id: candidate.opportunityId || null,
      rulebook_stage_key: candidate.rulebookStageKey || null,
      rulebook_step_key: candidate.rulebookStepKey || null,
      title: candidate.title,
      evidence_json: candidate.evidence,
      recommendation: candidate.recommendation || null,
      responsible_role_key: candidate.responsibleRoleKey || null,
      responsible_profile_id: candidate.responsibleProfileId || null,
      status: "open",
      detected_at: now,
      last_detected_at: now,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to insert finding: ${insertError.message}`);
  }

  return { finding: mapFinding(inserted), isNew: true };
}

/**
 * Resolve findings that are no longer detected.
 * Finds all open/alerted/acknowledged findings for a check that are NOT in seenDedupeKeys.
 * Marks them as resolved.
 */
export async function resolveMissingFindings(
  checkKey: CheckKey,
  seenDedupeKeys: string[],
): Promise<number> {
  const supabase = createServiceClient();

  const query = supabase
    .from("monitoring_findings")
    .select("id, dedupe_key")
    .eq("check_key", checkKey)
    .in("status", ["open", "alerted", "acknowledged"]);

  const { data: existing, error } = await query;

  if (error) {
    throw new Error(`Failed to query existing findings: ${error.message}`);
  }

  const toResolve = (existing || []).filter((f) => !seenDedupeKeys.includes(f.dedupe_key));

  if (toResolve.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("monitoring_findings")
    .update({
      status: "resolved",
      resolved_at: now,
    })
    .in(
      "id",
      toResolve.map((f) => f.id),
    );

  if (updateError) {
    throw new Error(`Failed to resolve findings: ${updateError.message}`);
  }

  return toResolve.length;
}

/**
 * List findings with filters.
 */
export async function listFindings(filters?: FindingFilters): Promise<MonitoringFinding[]> {
  const supabase = createServiceClient();
  let query = supabase.from("monitoring_findings").select("*");

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in("status", filters.status);
    } else {
      query = query.eq("status", filters.status);
    }
  }

  if (filters?.checkKey) {
    query = query.eq("check_key", filters.checkKey);
  }

  if (filters?.severity) {
    query = query.eq("severity", filters.severity);
  }

  if (filters?.entityType) {
    query = query.eq("entity_type", filters.entityType);
  }

  if (filters?.opportunityId) {
    query = query.eq("opportunity_id", filters.opportunityId);
  }

  if (filters?.contactId) {
    query = query.eq("contact_id", filters.contactId);
  }

  query = query.order("last_detected_at", { ascending: false });

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 100) - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list findings: ${error.message}`);
  }

  return (data || []).map(mapFinding);
}

/**
 * Get a single finding by ID.
 */
export async function getFinding(id: string): Promise<MonitoringFinding | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("monitoring_findings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to get finding: ${error.message}`);
  }

  return mapFinding(data);
}

/**
 * Acknowledge a finding (Slack reaction ✅).
 */
export async function acknowledgeFinding(id: string, slackUserId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("monitoring_findings")
    .update({
      status: "acknowledged",
      acknowledged_at: now,
      acknowledged_by_slack_user_id: slackUserId,
    })
    .eq("id", id)
    .in("status", ["open", "alerted"]);

  if (error) {
    throw new Error(`Failed to acknowledge finding: ${error.message}`);
  }
}

/**
 * Dismiss a finding as false positive (Slack reaction ❌).
 */
export async function dismissFalsePositive(id: string, slackUserId: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("monitoring_findings")
    .update({
      status: "dismissed_false_positive",
      dismissed_at: now,
      dismissed_by_slack_user_id: slackUserId,
    })
    .eq("id", id)
    .in("status", ["open", "alerted", "acknowledged"]);

  if (error) {
    throw new Error(`Failed to dismiss finding: ${error.message}`);
  }
}

/**
 * Atomically claim an open finding for delivery (optimistic concurrency).
 * Returns the claimed finding, or null if another worker already claimed it.
 */
export async function claimOpenFindingForDelivery(id: string): Promise<MonitoringFinding | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("monitoring_findings")
    .update({ status: "delivering", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim finding for delivery: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapFinding(data);
}

/**
 * Release a delivery claim so the finding can be retried (post failed / aborted).
 */
export async function releaseDeliveryClaim(id: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("monitoring_findings")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "delivering");

  if (error) {
    throw new Error(`Failed to release delivery claim: ${error.message}`);
  }
}

/**
 * Mark a finding as alerted with Slack refs.
 * Accepts open or delivering (claim-then-post) so race-safe delivery can finalize.
 */
export async function markAlerted(id: string, slackRef: SlackAlertRef): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("monitoring_findings")
    .update({
      status: "alerted",
      alerted_at: now,
      slack_channel_id: slackRef.channelId,
      slack_message_ts: slackRef.messageTs,
      slack_thread_ts: slackRef.threadTs || null,
    })
    .eq("id", id)
    .in("status", ["open", "delivering"]);

  if (error) {
    throw new Error(`Failed to mark finding as alerted: ${error.message}`);
  }
}

/**
 * Release abandoned delivery claims (e.g. worker crashed after claim, before Slack post).
 * Only reclaim claims older than `olderThanMinutes` so concurrent deliveries are not disturbed.
 */
export async function reclaimAbandonedDeliveryClaims(olderThanMinutes = 10): Promise<number> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("monitoring_findings")
    .update({ status: "open", updated_at: new Date().toISOString() })
    .eq("status", "delivering")
    .lt("updated_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`Failed to reclaim abandoned delivery claims: ${error.message}`);
  }

  return data?.length ?? 0;
}

/**
 * Mark a finding as escalated.
 */
export async function markEscalated(id: string): Promise<void> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("monitoring_findings")
    .update({
      escalated_at: now,
    })
    .eq("id", id)
    .eq("status", "alerted")
    .is("escalated_at", null);

  if (error) {
    throw new Error(`Failed to mark finding as escalated: ${error.message}`);
  }
}

/**
 * Compute false positive rate over a period.
 * FP rate = FP / (alerted + acknowledged + resolved + FP)
 * Only among findings that were ever alerted.
 */
export async function computeFalsePositiveRate(sinceIso: string): Promise<number> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("monitoring_findings")
    .select("status")
    .not("alerted_at", "is", null)
    .gte("detected_at", sinceIso);

  if (error) {
    throw new Error(`Failed to compute false positive rate: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return 0;
  }

  const relevant = data.filter((f) =>
    ["alerted", "acknowledged", "resolved", "dismissed_false_positive"].includes(f.status),
  );

  if (relevant.length === 0) {
    return 0;
  }

  const fpCount = relevant.filter((f) => f.status === "dismissed_false_positive").length;
  return fpCount / relevant.length;
}

/**
 * Find a finding by Slack message ts for reaction routing.
 */
export async function findBySlackMessage(
  channelId: string,
  messageTs: string,
): Promise<MonitoringFinding | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("monitoring_findings")
    .select("*")
    .eq("slack_channel_id", channelId)
    .eq("slack_message_ts", messageTs)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to find finding by slack message: ${error.message}`);
  }

  return mapFinding(data);
}

function mapFinding(row: Record<string, unknown>): MonitoringFinding {
  return {
    id: row.id as string,
    check_key: row.check_key as string,
    dedupe_key: row.dedupe_key as string,
    severity: row.severity as MonitoringFinding["severity"],
    entity_type: row.entity_type as MonitoringFinding["entity_type"],
    entity_id: row.entity_id as string | null,
    contact_id: row.contact_id as string | null,
    opportunity_id: row.opportunity_id as string | null,
    rulebook_stage_key: row.rulebook_stage_key as string | null,
    rulebook_step_key: row.rulebook_step_key as string | null,
    title: row.title as string,
    evidence_json: (row.evidence_json as Record<string, unknown>) || {},
    recommendation: row.recommendation as string | null,
    responsible_role_key: row.responsible_role_key as string | null,
    responsible_profile_id: row.responsible_profile_id as string | null,
    status: row.status as MonitoringFinding["status"],
    detected_at: row.detected_at as string,
    last_detected_at: row.last_detected_at as string,
    alerted_at: row.alerted_at as string | null,
    acknowledged_at: row.acknowledged_at as string | null,
    acknowledged_by_slack_user_id: row.acknowledged_by_slack_user_id as string | null,
    resolved_at: row.resolved_at as string | null,
    dismissed_at: row.dismissed_at as string | null,
    dismissed_by_slack_user_id: row.dismissed_by_slack_user_id as string | null,
    escalated_at: row.escalated_at as string | null,
    slack_channel_id: row.slack_channel_id as string | null,
    slack_message_ts: row.slack_message_ts as string | null,
    slack_thread_ts: row.slack_thread_ts as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
