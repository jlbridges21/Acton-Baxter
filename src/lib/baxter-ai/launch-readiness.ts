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

export type LaunchOverallStatus =
  "not_ready" | "needs_attention" | "ready_for_pilot" | "ready_for_employee_rollout";

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
        healthy: ghlHealth?.overall === "healthy" || ghlHealth?.overall === "warning",
      }
    : null;

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

  if (
    blockers.length === 0 &&
    attention.length === 0 &&
    openaiOk &&
    knowledgeOk &&
    googleOk &&
    slackOk &&
    ghlOk
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
    security,
    openaiMetrics,
    links: {
      diagnostics: "/admin/baxter/diagnostics",
      google: "/admin/connectors/google",
      ghl: "/admin/connectors/ghl",
      slack: "/admin/slack",
      knowledge: "/admin/knowledge",
      feedback: "/admin/baxter/feedback",
      checklist: "/docs/production-checklist.md",
    },
  };
}
