import "server-only";

import { getEnv } from "@/lib/env";
import { getBaxterDiagnosticsSnapshot, runOpenAiDiagnosticTest } from "@/lib/baxter-ai/diagnostics";
import { getOpenAiMetricsSnapshot } from "@/lib/baxter-ai/openai-metrics";
import { openaiAdminGuidance } from "@/lib/baxter-ai/errors";
import { getAdminSlackSnapshot } from "@/lib/slack/admin";
import { evaluateSlackHealth } from "@/lib/slack/config";
import { getGoogleAdminOverview } from "@/lib/connectors/google/diagnostics";
import { isGhlEnabled, isGhlConfigured } from "@/lib/connectors/ghl/config";
import { evaluateGhlHealth } from "@/lib/connectors/ghl/health";
import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { getPemNeatHealthSnapshot } from "@/lib/pem-neat/health";
import { getActiveRulebook } from "@/lib/rulebook/versions";
import { noteActiveRulebookPresence } from "@/lib/rulebook/capabilities";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";
import { listProjectSetupRuns } from "@/lib/project-setup/store";
import { createServiceClient } from "@/lib/supabase/admin";

export type LaunchOverallStatus =
  "not_ready" | "needs_attention" | "ready_for_pilot" | "ready_for_employee_rollout";

/** Same ballpark as job reclaim (5 min) — project setup runs stuck in "running". */
const PROJECT_SETUP_STUCK_MS = 15 * 60_000;
/** Monitoring sweep older than this while enabled → needs_attention. */
const MONITORING_STALE_SWEEP_MS = 48 * 60 * 60_000;

export type LaunchSectionReadiness = "ok" | "needs_attention" | "not_configured" | "informational";

/** Pure severity helpers (also used by section builders). */
export function assessProjectSetupReadiness(input: {
  stuckCount: number;
  finishedCount: number;
  completeCount: number;
  failedCount: number;
}): LaunchSectionReadiness {
  const successRate = input.finishedCount > 0 ? input.completeCount / input.finishedCount : null;
  if (input.stuckCount > 0) return "needs_attention";
  if (input.finishedCount >= 2 && successRate != null && successRate < 0.5) {
    return "needs_attention";
  }
  if (input.completeCount > 0) return "ok";
  return "informational";
}

export function assessRulebookReadiness(input: {
  hasActive: boolean;
  validationValid: boolean | null;
}): LaunchSectionReadiness {
  if (input.hasActive && input.validationValid === false) return "needs_attention";
  if (input.hasActive) return "ok";
  return "informational";
}

export function assessMonitoringReadiness(input: {
  uiEnabled: boolean;
  enabled: boolean;
  pilotChannelConfigured: boolean;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  lastRunError: string | null;
  nowMs?: number;
}): LaunchSectionReadiness {
  if (!input.uiEnabled) return "informational";
  if (!input.enabled) return "informational";
  if (!input.pilotChannelConfigured) return "needs_attention";
  if (!input.lastRunAt) return "needs_attention";
  if (input.lastRunStatus === "failed" || input.lastRunError) return "needs_attention";
  const age = (input.nowMs ?? Date.now()) - new Date(input.lastRunAt).getTime();
  if (age > MONITORING_STALE_SWEEP_MS) return "needs_attention";
  return "ok";
}

export function assessPemReadiness(input: {
  aiProviderReady: boolean;
  databaseReady: boolean;
  status: string;
  failedCount: number;
  lastErrorCode: string | null;
  staleCount: number;
}): LaunchSectionReadiness {
  if (!input.aiProviderReady || input.status === "Error" || !input.databaseReady) {
    return "needs_attention";
  }
  if (input.failedCount > 0 || input.lastErrorCode) return "needs_attention";
  if (input.staleCount > 0) return "needs_attention";
  return "ok";
}

async function buildPemSection() {
  const health = await getPemNeatHealthSnapshot();
  let failedCount = 0;
  let staleCount = 0;
  let completedCount = health.activeCount ?? 0;
  try {
    const supabase = createServiceClient();
    const { count: failed } = await supabase
      .from("pem_neats")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .is("deleted_at", null);
    const { count: stale } = await supabase
      .from("pem_neats")
      .select("id", { count: "exact", head: true })
      .or("status.eq.needs_regeneration,analysis_stale.eq.true")
      .is("deleted_at", null);
    const { count: completed } = await supabase
      .from("pem_neats")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .is("deleted_at", null);
    failedCount = failed ?? 0;
    staleCount = stale ?? 0;
    completedCount = completed ?? completedCount;
  } catch {
    // memory / missing table
  }

  const readiness = assessPemReadiness({
    aiProviderReady: health.aiProviderReady,
    databaseReady: health.databaseReady,
    status: health.status,
    failedCount,
    lastErrorCode: health.lastErrorCode,
    staleCount,
  });

  return {
    status: health.status,
    databaseReady: health.databaseReady,
    aiProviderReady: health.aiProviderReady,
    configuredModel: health.configuredModel,
    lastGenerationStatus: health.lastGenerationStatus,
    lastErrorCode: health.lastErrorCode,
    completedCount,
    failedCount,
    staleCount,
    readiness,
  };
}

async function buildRulebookSection() {
  // Severity: no active rulebook is informational only (optional infrastructure, not a
  // rollout blocker). Active with validation errors → needs_attention. Active + valid → ok.
  let activeVersion: string | null = null;
  let validationValid: boolean | null = null;
  let hasActive = false;
  try {
    const active = await getActiveRulebook();
    hasActive = Boolean(active);
    noteActiveRulebookPresence(hasActive);
    if (active) {
      activeVersion = String(active.version_number ?? active.id);
      const report = active.validation_report_json as { valid?: boolean } | null;
      validationValid = report?.valid !== false;
    }
  } catch {
    hasActive = false;
    noteActiveRulebookPresence(false);
  }

  const readiness = assessRulebookReadiness({ hasActive, validationValid });

  return {
    hasActive,
    activeVersion,
    validationValid,
    readiness,
  };
}

async function buildMonitoringSection() {
  // Severity: UI disabled / feature off → informational (not a blocker).
  // Enabled without pilot channel → needs_attention.
  // Enabled + last sweep failed or never / stale → needs_attention.
  // Enabled + recent successful sweep → ok.
  if (!PROCESS_MONITORING_UI_ENABLED) {
    return {
      uiEnabled: false,
      enabled: false,
      pilotChannelConfigured: false,
      pilotChannelName: null as string | null,
      lastRunStatus: null as string | null,
      lastRunAt: null as string | null,
      lastRunError: null as string | null,
      readiness: "informational" as LaunchSectionReadiness,
    };
  }

  try {
    const { getMonitoringSettings } = await import("@/lib/monitoring/settings");
    const { getMonitoringDashboardSummary } = await import("@/lib/monitoring/metrics");
    const settings = await getMonitoringSettings();
    const summary = await getMonitoringDashboardSummary();
    const lastRun = summary.lastRun;
    const pilotChannelConfigured = Boolean(settings.pilot_slack_channel_id);
    const lastRunAt = lastRun?.completed_at ?? lastRun?.started_at ?? null;

    const readiness = assessMonitoringReadiness({
      uiEnabled: true,
      enabled: settings.enabled,
      pilotChannelConfigured,
      lastRunStatus: lastRun?.status ?? null,
      lastRunAt,
      lastRunError: lastRun?.error_message ?? null,
    });

    return {
      uiEnabled: true,
      enabled: settings.enabled,
      pilotChannelConfigured,
      pilotChannelName: settings.pilot_slack_channel_name,
      lastRunStatus: lastRun?.status ?? null,
      lastRunAt,
      lastRunError: lastRun?.error_message ?? null,
      readiness,
    };
  } catch {
    return {
      uiEnabled: true,
      enabled: false,
      pilotChannelConfigured: false,
      pilotChannelName: null,
      lastRunStatus: null,
      lastRunAt: null,
      lastRunError: "Unable to load monitoring settings/runs",
      readiness: "needs_attention" as LaunchSectionReadiness,
    };
  }
}

async function buildProjectSetupSection() {
  // Severity: no recent runs → informational (feature may be unused).
  // Any stuck "running" run (older than PROJECT_SETUP_STUCK_MS) → needs_attention.
  // Recent failure rate ≥ 50% with ≥2 finished runs → needs_attention.
  // Otherwise ok when there is at least one recent complete run, else informational.
  const runs = await listProjectSetupRuns(25).catch(() => []);
  const now = Date.now();
  const stuckRuns = runs.filter(
    (r) =>
      r.status === "running" &&
      now - new Date(r.updatedAt || r.startedAt || r.createdAt).getTime() > PROJECT_SETUP_STUCK_MS,
  );
  const finished = runs.filter((r) => r.status === "complete" || r.status === "failed");
  const complete = finished.filter((r) => r.status === "complete").length;
  const failed = finished.filter((r) => r.status === "failed").length;
  const successRate = finished.length > 0 ? complete / finished.length : null;

  const readiness = assessProjectSetupReadiness({
    stuckCount: stuckRuns.length,
    finishedCount: finished.length,
    completeCount: complete,
    failedCount: failed,
  });

  return {
    recentRunCount: runs.length,
    completeCount: complete,
    failedCount: failed,
    stuckCount: stuckRuns.length,
    successRate,
    lastStatus: runs[0]?.status ?? null,
    lastUpdatedAt: runs[0]?.updatedAt ?? runs[0]?.createdAt ?? null,
    readiness,
  };
}

export async function getLaunchReadinessSnapshot(options?: { runLiveOpenAi?: boolean }) {
  const env = getEnv();
  const diagnostics = await getBaxterDiagnosticsSnapshot();
  const openaiMetrics = getOpenAiMetricsSnapshot();
  const slack = await getAdminSlackSnapshot();
  const slackHealth = await evaluateSlackHealth();
  const google = await getGoogleAdminOverview();

  const ghlEnabled = isGhlEnabled();
  const ghlConfigured = isGhlConfigured();
  const ghlHealth = ghlConfigured ? await evaluateGhlHealth() : null;

  const entries = await listAllKnowledgeEntriesForRetrieval();
  const approved = entries.filter((e) => e.status === "approved" && e.visibility === "internal");
  const googleEntries = approved.filter((e) => e.source_type === "Google Drive");

  let openaiLive: { pass: boolean; error?: string } | null = null;
  if (options?.runLiveOpenAi && diagnostics.config.openaiKeyPresent) {
    try {
      const result = await runOpenAiDiagnosticTest();
      openaiLive = { pass: result.pass };
    } catch (error) {
      openaiLive = {
        pass: false,
        error: error instanceof Error ? error.message.slice(0, 160) : "failed",
      };
    }
  }

  const webChat = {
    enabled: diagnostics.config.chatEnabled,
    openaiKeyPresent: diagnostics.config.openaiKeyPresent,
    recentSuccessfulAnswers: diagnostics.conversations.successfulAssistantResponses,
    recentFailures: diagnostics.conversations.failedResponses,
    openaiLivePass: openaiLive?.pass ?? null,
    lastOpenAiError: openaiMetrics.lastSafeErrorCode,
    quotaErrorsLast24h: openaiMetrics.quotaErrorsLast24h,
  };

  const knowledge = {
    approvedEntries: approved.length,
    googleSyncedEntries: googleEntries.length,
    lastGoogleSync: diagnostics.knowledge.lastGoogleSync,
    hasWorkingSource: approved.length > 0,
  };

  const googleSection = {
    configured: google.config.configured,
    privateKeyValid: google.config.privateKeyFormatValid,
    authenticated: google.authenticated,
    rootFolderConfigured: google.config.rootFolderConfigured,
    lastError: google.health.lastError,
    syncFresh:
      Boolean(diagnostics.knowledge.lastGoogleSync) &&
      Date.now() - new Date(diagnostics.knowledge.lastGoogleSync!).getTime() <
        7 * 24 * 60 * 60 * 1000,
  };

  const slackSection = {
    enabled: slack.config.integrationEnabled,
    configComplete: slack.config.missingRequired.length === 0 && slack.config.integrationEnabled,
    status: slackHealth.status,
    teamAllowlist: slack.config.allowedTeamIds.length > 0,
    channelRestrictions: slack.config.allowedChannelCount > 0,
    lastSuccessfulReply: slack.stats.lastCompletedAt,
    pendingJobs: slack.stats.pendingJobs,
    failedJobs: slack.stats.failedJobs,
  };

  const ghlSection = ghlEnabled
    ? {
        enabled: ghlEnabled,
        configured: ghlConfigured,
        status: ghlHealth?.overall ?? "offline",
        locationId: ghlHealth?.locationId ?? null,
        authMode: ghlHealth?.authMode ?? null,
        healthy:
          ghlHealth?.overall === "healthy" ||
          ghlHealth?.overall === "connected" ||
          ghlHealth?.overall === "warning" ||
          ghlHealth?.overall === "connected_limited",
        readiness: !ghlConfigured
          ? ("not_configured" as const)
          : ghlHealth?.overall === "connected" || ghlHealth?.overall === "healthy"
            ? ("read_ready" as const)
            : ("needs_attention" as const),
      }
    : null;

  const [pemSection, rulebookSection, monitoringSection, projectSetupSection] = await Promise.all([
    buildPemSection(),
    buildRulebookSection(),
    buildMonitoringSection(),
    buildProjectSetupSection(),
  ]);

  const security = {
    supabaseServiceRolePresent: diagnostics.config.supabaseServiceRolePresent,
    openaiKeyPresent: diagnostics.config.openaiKeyPresent,
    appBaseUrl: env.APP_BASE_URL,
    cronSecretConfigured: Boolean(
      (process.env.CRON_SECRET ?? "").trim() || (env.INTERNAL_CRON_SECRET ?? "").trim(),
    ),
    slackTeamRestricted: !slack.config.integrationEnabled || slack.config.allowedTeamIds.length > 0,
    productionHttps: env.APP_BASE_URL.startsWith("https://"),
  };

  const openaiOk =
    webChat.enabled &&
    webChat.openaiKeyPresent &&
    webChat.quotaErrorsLast24h === 0 &&
    (webChat.recentSuccessfulAnswers > 0 || webChat.openaiLivePass === true);

  const knowledgeOk = knowledge.approvedEntries > 0;
  const googleOk =
    !google.config.configured ||
    (googleSection.privateKeyValid && googleSection.authenticated && googleEntries.length > 0);
  const slackOk =
    !slackSection.enabled ||
    (slackSection.configComplete &&
      slackSection.status !== "offline" &&
      slackSection.status !== "misconfigured");

  const ghlOk = !ghlSection || !ghlSection.enabled || ghlSection.healthy;
  // PEM/monitoring/project-setup: needs_attention feeds overall attention, not hard blockers
  // (except PEM DB/AI hard failure is still attention — chat can work without PEM).
  const pemOk = pemSection.readiness !== "needs_attention";
  const monitoringOk = monitoringSection.readiness !== "needs_attention";
  const projectSetupOk = projectSetupSection.readiness !== "needs_attention";
  const rulebookOk = rulebookSection.readiness !== "needs_attention";

  let overall: LaunchOverallStatus = "not_ready";
  const blockers: string[] = [];
  const attention: string[] = [];

  if (!webChat.enabled) blockers.push("Baxter chat is disabled (BAXTER_CHAT_ENABLED).");
  if (!webChat.openaiKeyPresent) blockers.push("OPENAI_API_KEY is missing.");
  if (webChat.quotaErrorsLast24h > 0) {
    attention.push(
      `OpenAI quota/billing errors in last 24h (${openaiMetrics.lastSafeErrorCode ?? "quota"}). ${openaiAdminGuidance(openaiMetrics.lastSafeErrorCode ?? "BAXTER_OPENAI_QUOTA_EXCEEDED").join(" ")}`,
    );
  }
  if (!knowledgeOk) blockers.push("No approved Knowledge Base entries.");
  if (google.config.configured && !googleSection.authenticated) {
    attention.push("Google credentials are present but authentication is failing.");
  }
  if (google.config.configured && googleEntries.length === 0) {
    attention.push("Google is configured but no Google knowledge entries are synced yet.");
  }
  if (slackSection.enabled && !slackSection.configComplete) {
    attention.push(
      `Slack is enabled but misconfigured: ${slack.config.missingRequired.join(", ")}`,
    );
  }
  if (ghlSection?.enabled && !ghlSection.configured) {
    attention.push("GoHighLevel is enabled but not fully configured.");
  }
  if (ghlSection?.enabled && ghlSection.configured && !ghlSection.healthy) {
    attention.push(`GoHighLevel connector is ${ghlSection.status}. Check /admin/connectors/ghl.`);
  }
  if (!security.cronSecretConfigured && (slackSection.enabled || google.config.configured)) {
    attention.push(
      "CRON_SECRET (or legacy INTERNAL_CRON_SECRET) is missing — Vercel Cron cannot authorize /api/internal/process-jobs.",
    );
  }
  if (pemSection.readiness === "needs_attention") {
    if (!pemSection.databaseReady || pemSection.status === "Error") {
      attention.push("PEM NEAT storage or AI provider is unhealthy.");
    } else if (pemSection.failedCount > 0 || pemSection.lastErrorCode) {
      attention.push(
        `PEM NEAT has failed generations (${pemSection.failedCount}) or last error ${pemSection.lastErrorCode}.`,
      );
    } else if (pemSection.staleCount > 0) {
      attention.push(`${pemSection.staleCount} PEM NEAT record(s) are stale / need regeneration.`);
    }
  }
  if (rulebookSection.readiness === "needs_attention") {
    attention.push(
      "Active Process Rulebook has validation errors — fix before relying on RACI answers.",
    );
  }
  if (monitoringSection.readiness === "needs_attention") {
    if (monitoringSection.enabled && !monitoringSection.pilotChannelConfigured) {
      attention.push("Process Monitoring is enabled but no pilot Slack channel is configured.");
    } else if (monitoringSection.enabled && !monitoringSection.lastRunAt) {
      attention.push("Process Monitoring is enabled but no sweep has run yet.");
    } else if (monitoringSection.lastRunStatus === "failed" || monitoringSection.lastRunError) {
      attention.push(
        `Process Monitoring last sweep failed${monitoringSection.lastRunError ? `: ${monitoringSection.lastRunError}` : "."}`,
      );
    } else {
      attention.push("Process Monitoring last sweep is stale or unhealthy.");
    }
  }
  if (projectSetupSection.readiness === "needs_attention") {
    if (projectSetupSection.stuckCount > 0) {
      attention.push(
        `${projectSetupSection.stuckCount} Project Setup run(s) appear stuck in running.`,
      );
    } else {
      attention.push("Project Setup recent failure rate is high — check /admin/project-setup.");
    }
  }

  if (
    blockers.length === 0 &&
    attention.length === 0 &&
    openaiOk &&
    knowledgeOk &&
    googleOk &&
    slackOk &&
    ghlOk &&
    pemOk &&
    monitoringOk &&
    projectSetupOk &&
    rulebookOk
  ) {
    if (
      slackSection.enabled &&
      slackSection.lastSuccessfulReply &&
      googleEntries.length > 0 &&
      webChat.recentSuccessfulAnswers > 0
    ) {
      overall = "ready_for_employee_rollout";
    } else {
      overall = "ready_for_pilot";
    }
  } else if (blockers.length === 0) {
    overall = "needs_attention";
  } else {
    overall = "not_ready";
  }

  return {
    overall,
    overallLabel:
      overall === "ready_for_employee_rollout"
        ? "Ready for employee rollout"
        : overall === "ready_for_pilot"
          ? "Ready for pilot"
          : overall === "needs_attention"
            ? "Needs attention"
            : "Not ready",
    blockers,
    attention,
    webChat,
    knowledge,
    google: googleSection,
    slack: slackSection,
    ghl: ghlSection,
    pemNeat: pemSection,
    rulebook: rulebookSection,
    monitoring: monitoringSection,
    projectSetup: projectSetupSection,
    security,
    openaiMetrics,
    links: {
      diagnostics: "/admin/baxter/diagnostics",
      google: "/admin/connectors/google",
      ghl: "/admin/connectors/ghl",
      slack: "/admin/slack",
      knowledge: "/admin/knowledge",
      feedback: "/admin/baxter/feedback",
      pemNeats: "/pem-neats",
      rulebook: "/admin/baxter/rulebook",
      monitoring: "/admin/baxter/monitoring",
      projectSetup: "/admin/project-setup",
      checklist: "/docs/production-checklist.md",
    },
  };
}

/** Exported for unit tests of section severity mapping. */
export const __launchReadinessInternals = {
  PROJECT_SETUP_STUCK_MS,
  MONITORING_STALE_SWEEP_MS,
};
