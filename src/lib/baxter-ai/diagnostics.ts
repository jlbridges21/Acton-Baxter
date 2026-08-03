import "server-only";

import { getEnv } from "@/lib/env";
import { isGoogleWorkspaceConfigured } from "@/lib/connectors/google/auth";
import { listGoogleSyncFolders } from "@/lib/connectors/google/folders";
import { isGhlConfigured, isGhlEnabled } from "@/lib/connectors/ghl/config";
import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import {
  listRecentConversations,
  listMessagesForConversation,
} from "@/lib/baxter-ai/conversations";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { OpenAIBaxterProvider } from "@/lib/baxter-ai/openai-provider";
import { createKnowledgeEntry, patchKnowledgeEntrySyncFields } from "@/lib/knowledge/store";
import { BAXTER_BOOTSTRAP_TITLE, BAXTER_BOOTSTRAP_CONTENT } from "./bootstrap-content";
import { getOpenAiMetricsSnapshot } from "./openai-metrics";
import { classifyOpenAiHttpError, employeeFacingErrorMessage, openaiAdminGuidance } from "./errors";
import { getBaxterProviderDiagnostics } from "./providers";
import { getEmbeddingConfig } from "@/lib/knowledge-index/embeddings";
import { getBaxterVisionProvider } from "./vision";
import { getKnowledgeHealthSummary } from "./knowledge-health";
import { getGovernanceAdminSummary, assembleBaxterRuntime } from "./governance";
import { getPemNeatHealthSnapshot } from "@/lib/pem-neat/health";
import {
  capabilityRegistryStats,
  describeConceptRoutingDiagnostics,
  getCapabilityRuntimeHealth,
} from "@/lib/baxter/capability-registry";
import { isMonitoringCapabilityKnown } from "@/lib/baxter-ai/governance/capabilities";
import { createServiceClient } from "@/lib/supabase/admin";
import { getActiveRulebook } from "@/lib/rulebook/versions";
import { noteActiveRulebookPresence } from "@/lib/rulebook/capabilities";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";
import { listProjectSetupRuns } from "@/lib/project-setup/store";

export async function getBaxterDiagnosticsSnapshot() {
  const env = getEnv();
  const providerDiag = getBaxterProviderDiagnostics();
  const embedding = getEmbeddingConfig();
  const vision = getBaxterVisionProvider();
  const pemNeat = await getPemNeatHealthSnapshot();
  const capabilityHealth = getCapabilityRuntimeHealth({
    monitoringKnown: isMonitoringCapabilityKnown(),
  });
  const capabilityStats = capabilityRegistryStats(capabilityHealth);
  const conceptRoutingSample = describeConceptRoutingDiagnostics("What is a PEM NEAT?");

  let completedPems: number | null = pemNeat.activeCount;
  let stalePems: number | null = null;
  try {
    const supabase = createServiceClient();
    const { count: completedCount } = await supabase
      .from("pem_neats")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .is("deleted_at", null);
    const { count: staleCount } = await supabase
      .from("pem_neats")
      .select("id", { count: "exact", head: true })
      .or("status.eq.needs_regeneration,analysis_stale.eq.true")
      .is("deleted_at", null);
    completedPems = completedCount ?? completedPems;
    stalePems = staleCount ?? 0;
  } catch {
    // memory/E2E — leave counts from pemNeat health
  }

  const rulebook = await (async () => {
    try {
      const active = await getActiveRulebook();
      noteActiveRulebookPresence(Boolean(active));
      const report = active?.validation_report_json as { valid?: boolean } | null;
      return {
        hasActive: Boolean(active),
        activeVersion: active ? String(active.version_number ?? active.id) : null,
        validationValid: active ? report?.valid !== false : null,
        activatedAt: active?.activated_at ?? active?.updated_at ?? null,
      };
    } catch {
      noteActiveRulebookPresence(false);
      return {
        hasActive: false,
        activeVersion: null,
        validationValid: null,
        activatedAt: null,
      };
    }
  })();

  const monitoring = await (async () => {
    if (!PROCESS_MONITORING_UI_ENABLED) {
      return {
        uiEnabled: false,
        enabled: false,
        pilotChannelConfigured: false,
        pilotChannelName: null as string | null,
        lastRunStatus: null as string | null,
        lastRunAt: null as string | null,
        lastRunError: null as string | null,
        openFindings: null as number | null,
      };
    }
    try {
      const { getMonitoringSettings } = await import("@/lib/monitoring/settings");
      const { getMonitoringDashboardSummary } = await import("@/lib/monitoring/metrics");
      const settings = await getMonitoringSettings();
      const summary = await getMonitoringDashboardSummary();
      return {
        uiEnabled: true,
        enabled: settings.enabled,
        pilotChannelConfigured: Boolean(settings.pilot_slack_channel_id),
        pilotChannelName: settings.pilot_slack_channel_name,
        lastRunStatus: summary.lastRun?.status ?? null,
        lastRunAt: summary.lastRun?.completed_at ?? summary.lastRun?.started_at ?? null,
        lastRunError: summary.lastRun?.error_message ?? null,
        openFindings: summary.openCount,
      };
    } catch (error) {
      return {
        uiEnabled: true,
        enabled: false,
        pilotChannelConfigured: false,
        pilotChannelName: null,
        lastRunStatus: null,
        lastRunAt: null,
        lastRunError: error instanceof Error ? error.message.slice(0, 160) : "load_failed",
        openFindings: null,
      };
    }
  })();

  const projectSetup = await (async () => {
    const runs = await listProjectSetupRuns(25).catch(() => []);
    const stuckMs = 15 * 60_000;
    const now = Date.now();
    const stuck = runs.filter(
      (r) =>
        r.status === "running" &&
        now - new Date(r.updatedAt || r.startedAt || r.createdAt).getTime() > stuckMs,
    );
    const finished = runs.filter((r) => r.status === "complete" || r.status === "failed");
    const complete = finished.filter((r) => r.status === "complete").length;
    const failed = finished.filter((r) => r.status === "failed").length;
    return {
      recentRunCount: runs.length,
      completeCount: complete,
      failedCount: failed,
      stuckCount: stuck.length,
      lastStatus: runs[0]?.status ?? null,
      lastUpdatedAt: runs[0]?.updatedAt ?? null,
    };
  })();

  const entries = await listAllKnowledgeEntriesForRetrieval();
  const approvedInternal = entries.filter(
    (entry) => entry.status === "approved" && entry.visibility === "internal",
  );
  const folders = await listGoogleSyncFolders();
  const conversations = await listRecentConversations(100);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = conversations.filter(
    (conversation) => new Date(conversation.created_at).getTime() >= since,
  );

  let successful = 0;
  let insufficient = 0;
  let failed = 0;
  const errorCodes: string[] = [];

  for (const conversation of recent.slice(0, 40)) {
    const messages = await listMessagesForConversation(conversation.id);
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      if (message.error_code) {
        failed += 1;
        errorCodes.push(message.error_code);
      } else if (message.insufficient_knowledge) {
        insufficient += 1;
      } else {
        successful += 1;
      }
    }
  }

  const openaiMetrics = getOpenAiMetricsSnapshot();
  const knowledgeHealth = await getKnowledgeHealthSummary();
  const governance = getGovernanceAdminSummary();
  const runtime = assembleBaxterRuntime({ includeJsonContract: false });

  return {
    config: {
      chatEnabled: env.BAXTER_CHAT_ENABLED,
      provider: providerDiag.reasoningProvider,
      model: providerDiag.reasoningModel,
      fallbackProvider: providerDiag.fallbackProvider,
      fallbackModel: providerDiag.fallbackModel,
      embeddingProvider: providerDiag.embeddingProvider,
      embeddingModel: providerDiag.embeddingModel || embedding.model,
      visionProvider: providerDiag.visionProvider,
      visionModel: vision.model,
      propertyResearchAiProvider: providerDiag.propertyResearchAiProvider,
      openaiKeyPresent: Boolean((env.OPENAI_API_KEY ?? "").trim()),
      anthropicKeyPresent: Boolean((env.ANTHROPIC_API_KEY ?? "").trim()),
      supabaseServiceRolePresent: Boolean((env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()),
      googleConfigured: isGoogleWorkspaceConfigured(),
      ghlConfigured: isGhlConfigured(),
      ghlEnabled: isGhlEnabled(),
      slackConfigured: Boolean(
        env.ENABLE_SLACK_INTEGRATION &&
        env.SLACK_BOT_TOKEN &&
        env.SLACK_SIGNING_SECRET &&
        env.SLACK_ALLOWED_TEAM_IDS,
      ),
      runtimeVersion: runtime.runtimeVersion,
      governanceVersion: runtime.governanceVersion,
      loadedStandards: runtime.loadedStandards,
    },
    openai: {
      ...openaiMetrics,
      guidance: openaiMetrics.lastSafeErrorCode
        ? openaiAdminGuidance(openaiMetrics.lastSafeErrorCode)
        : [],
    },
    knowledge: {
      total: entries.length,
      approvedInternal: approvedInternal.length,
      draft: entries.filter((entry) => entry.status === "draft").length,
      archived: entries.filter((entry) => entry.status === "archived").length,
      googleSynced: entries.filter((entry) => entry.source_type === "Google Drive").length,
      manual: entries.filter((entry) => entry.source_type === "manual").length,
      lastGoogleSync:
        folders
          .map((folder) => folder.last_sync_at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
    },
    knowledgeHealth,
    governance: {
      runtimeVersion: governance.runtimeVersion,
      governanceVersion: governance.governanceVersion,
      openDecisionCount: governance.openDecisions.length,
      unresolvedRiskCount: governance.unresolvedRisks.length,
      note: governance.note,
    },
    conversations: {
      last24h: recent.length,
      successfulAssistantResponses: successful,
      insufficientKnowledgeResponses: insufficient,
      failedResponses: failed,
      recentErrorCodes: Array.from(new Set(errorCodes)).slice(0, 10),
    },
    pemNeat,
    rulebook,
    monitoring,
    projectSetup,
    baxterAwareness: {
      pemEvidenceProvider: pemNeat.databaseReady || pemNeat.activeCount != null ? "Ready" : "Error",
      completedPems,
      stalePems,
      deletedExcluded: true,
      capabilityCount: capabilityStats.total,
      enabledCapabilityCount: capabilityStats.enabled,
      conceptRoutingSample,
    },
  };
}

export async function runOpenAiDiagnosticTest() {
  const started = Date.now();
  try {
    const provider = new OpenAIBaxterProvider();
    const { buildBaxterOpenAiRequest } = await import("./openai-provider");
    const preview = buildBaxterOpenAiRequest({
      model: provider.model,
      systemPrompt: "Diagnostic.",
      userPrompt: "Reply OK as JSON answer.",
    });
    const result = await provider.generateAnswer({
      question: "Reply with the word OK as the answer field value.",
      contextItems: [
        {
          number: 1,
          id: "diag-synthetic",
          title: "Synthetic diagnostic evidence",
          summary: "Bounded test evidence",
          contentExcerpt: "This is synthetic evidence for provider health — not production data.",
          category: "Diagnostic",
          tags: ["diagnostic"],
          sourceName: "Baxter diagnostics",
          sourceUrl: null,
          sourceType: "capability",
          mimeType: null,
          updatedAt: new Date().toISOString(),
          citationLabel: "Baxter diagnostic",
          relevanceScore: 100,
        },
      ],
      channel: "web",
      questionClass: "general_knowledge",
      identityContext: "Diagnostic test.",
      history: [],
    });
    const ok = /\bok\b/i.test(result.answer);
    return {
      pass: ok,
      answerPreview: result.answer.slice(0, 200),
      model: result.modelName,
      api: preview.api,
      requestMode: "baxter_answer_json",
      latencyMs: result.latencyMs ?? Date.now() - started,
      code: null as string | null,
      guidance: [] as string[],
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_UNKNOWN_ERROR")
        : "BAXTER_UNKNOWN_ERROR";
    const details =
      error && typeof error === "object" && "details" in error
        ? (error as { details?: Record<string, unknown> | null }).details
        : null;
    return {
      pass: false,
      answerPreview: employeeFacingErrorMessage(code),
      model: details?.model ?? null,
      api: details?.api ?? null,
      openaiCode: details?.openaiCode ?? null,
      openaiParam: details?.openaiParam ?? null,
      requestMode: "baxter_answer_json",
      latencyMs: Date.now() - started,
      code,
      guidance: openaiAdminGuidance(code),
    };
  }
}

export async function runNormalDynamicAnswerDiagnostic(userId: string) {
  const result = await answerBaxterQuestion({
    question: "Can you respond to messages that are not hard coded?",
    userId,
    userName: "Diagnostics",
    channel: "web",
  });
  return {
    pass: Boolean(result.answer) && !result.errorCode,
    answerPreview: result.answer.slice(0, 320),
    answerMode: result.answerMode ?? null,
    sources: result.sources.length,
    errorCode: result.errorCode ?? null,
    conversationId: result.conversationId,
  };
}

export async function runRateLimitClassificationDiagnostic() {
  const cases = [
    {
      name: "temporary_rate_limit",
      status: 429,
      body: { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } },
      expected: "BAXTER_OPENAI_RATE_LIMITED",
    },
    {
      name: "quota_exceeded",
      status: 429,
      body: { error: { code: "insufficient_quota", type: "insufficient_quota" } },
      expected: "BAXTER_OPENAI_QUOTA_EXCEEDED",
    },
    {
      name: "billing_required",
      status: 429,
      body: { error: { message: "Billing hard limit has been reached" } },
      expected: "BAXTER_OPENAI_BILLING_REQUIRED",
    },
    {
      name: "auth_failed",
      status: 401,
      body: { error: { message: "Invalid API key" } },
      expected: "BAXTER_OPENAI_AUTH_FAILED",
    },
  ] as const;

  return {
    pass: cases.every((testCase) => {
      const classified = classifyOpenAiHttpError(testCase.status, testCase.body);
      return classified.code === testCase.expected;
    }),
    cases: cases.map((testCase) => {
      const classified = classifyOpenAiHttpError(testCase.status, testCase.body);
      return {
        name: testCase.name,
        expected: testCase.expected,
        actual: classified.code,
        retryable: classified.retryable,
        pass: classified.code === testCase.expected,
      };
    }),
  };
}

export async function runKnowledgeSearchDiagnosticTest() {
  const results = await searchApprovedKnowledge({ query: "Baxter", limit: 5 });
  return {
    pass: true,
    count: results.length,
    topTitles: results.slice(0, 5).map((row) => row.title),
  };
}

export async function runCompletePipelineDiagnosticTest(userId: string) {
  const result = await answerBaxterQuestion({
    question: "Who is Baxter?",
    userId,
    userName: "Diagnostics",
    channel: "web",
  });
  return {
    pass: Boolean(result.answer) && !result.errorCode,
    answerPreview: result.answer.slice(0, 280),
    answerMode: result.answerMode ?? null,
    sources: result.sources.length,
    insufficientKnowledge: result.insufficientKnowledge,
    errorCode: result.errorCode ?? null,
    conversationId: result.conversationId,
  };
}

export async function bootstrapBaxterOverviewEntry(userId: string) {
  const entries = await listAllKnowledgeEntriesForRetrieval();
  const existing = entries.find(
    (entry) =>
      entry.title === BAXTER_BOOTSTRAP_TITLE || entry.metadata?.bootstrapKey === "baxter-overview",
  );
  if (existing) {
    return { created: false, entryId: existing.id, title: existing.title };
  }

  const created = await createKnowledgeEntry(
    {
      title: BAXTER_BOOTSTRAP_TITLE,
      content: BAXTER_BOOTSTRAP_CONTENT,
      summary: "Approved overview of Baxter’s purpose, capabilities, and limits.",
      category: "Baxter",
      tags: ["baxter", "overview", "identity"],
      source_name: "Baxter",
      source_type: "manual",
      source_url: null,
      visibility: "internal",
      status: "approved",
    },
    userId,
  );

  await patchKnowledgeEntrySyncFields(created.id, {
    metadata: { bootstrapKey: "baxter-overview" },
  });

  return { created: true, entryId: created.id, title: created.title };
}
