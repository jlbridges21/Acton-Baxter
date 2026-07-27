import "server-only";

import { getEnv } from "@/lib/env";
import { isGoogleWorkspaceConfigured } from "@/lib/connectors/google/auth";
import { listGoogleSyncFolders } from "@/lib/connectors/google/folders";
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

export async function getBaxterDiagnosticsSnapshot() {
  const env = getEnv();
  const providerDiag = getBaxterProviderDiagnostics();
  const embedding = getEmbeddingConfig();
  const vision = getBaxterVisionProvider();
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
  };
}

export async function runOpenAiDiagnosticTest() {
  const started = Date.now();
  try {
    const provider = new OpenAIBaxterProvider();
    const result = await provider.generateAnswer({
      question: "Reply with the word OK as the answer field value.",
      contextItems: [],
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
      latencyMs: result.latencyMs ?? Date.now() - started,
      code: null as string | null,
      guidance: [] as string[],
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_UNKNOWN_ERROR")
        : "BAXTER_UNKNOWN_ERROR";
    return {
      pass: false,
      answerPreview: employeeFacingErrorMessage(code),
      model: null,
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
