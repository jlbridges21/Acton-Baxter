import "server-only";

import { evaluateSlackHealth, getSlackRuntimeConfig } from "@/lib/slack/config";
import { authTestSlack, postSlackMessage } from "@/lib/slack/client";
import { getSlackReceiptStats } from "@/lib/slack/receipts";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { buildBaxterSlackText } from "@/lib/slack/format";
import {
  listMessagesForConversation,
  listRecentConversations,
  getConversationForUser,
} from "@/lib/baxter-ai/conversations";
import { claimNextJob } from "@/lib/jobs/queue";
import { processJob } from "@/lib/jobs/process";
import { createServiceClient } from "@/lib/supabase/admin";
import { getSlackSearchDiagnosticsSnapshot } from "@/lib/baxter-data/slack/diagnostics";
import { getEnv } from "@/lib/env";
import { backfillSlackDisplayNames, getSlackIdentityCacheStats } from "@/lib/slack/profiles";
import {
  getSlackActivityOverview,
  getSlackChannelActivityDetail,
  getSlackUserActivityDetail,
  type SlackActivityFilters,
} from "@/lib/slack/activity";
import {
  formatResolvedChannelLabel,
  formatResolvedUserLabel,
  getCachedSlackChannelProfile,
  getCachedSlackUserProfile,
  resolveSlackChannelProfile,
  resolveSlackUserProfile,
} from "@/lib/slack/profiles";
import { parseSlackExternalThreadId } from "@/lib/slack/display-names";

export { getSlackActivityOverview, getSlackUserActivityDetail, getSlackChannelActivityDetail };
export type { SlackActivityFilters };
export async function getAdminSlackSnapshot(options?: { adminUserId?: string }) {
  const config = getSlackRuntimeConfig();
  const stats = await getSlackReceiptStats();
  const identity = await getSlackIdentityCacheStats();
  const search = await getSlackSearchDiagnosticsSnapshot(options?.adminUserId);
  const health = await evaluateSlackHealth({
    recentErrors: stats.failedJobs > 0 || stats.recentErrorCodes.length > 0,
    recentReactionScopeError: stats.recentErrorCodes.some((code) =>
      /missing_scope|no_permission|reaction/i.test(code),
    ),
  });

  const conversations = (await listRecentConversations(40)).filter((c) => c.channel === "slack");
  const activity = await Promise.all(
    conversations.slice(0, 20).map(async (conversation) => {
      const messages = await listMessagesForConversation(conversation.id);
      const latestUser = [...messages].reverse().find((m) => m.role === "user");
      const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const sources =
        latestAssistant &&
        Array.isArray((latestAssistant.metadata as { sources?: unknown }).sources)
          ? ((latestAssistant.metadata as { sources: Array<{ citationLabel?: string }> }).sources ??
            [])
          : [];
      return {
        conversationId: conversation.id,
        timestamp: conversation.last_message_at ?? conversation.created_at,
        eventType: conversation.external_thread_id?.includes(":") ? "slack" : "slack",
        channelKind:
          conversation.external_thread_id?.split(":").length === 3 ? "mapped" : "unknown",
        userLabel: conversation.user_display_name ?? conversation.external_user_id ?? "Slack user",
        questionExcerpt: (latestUser?.content ?? "").slice(0, 160),
        status: latestAssistant?.error_code ? "error" : latestAssistant ? "answered" : "pending",
        sourceCount: sources.length,
        errorCode: latestAssistant?.error_code ?? null,
      };
    }),
  );

  return {
    health,
    config: {
      integrationEnabled: config.enabled,
      signingSecretPresent: config.signingSecretPresent,
      botTokenPresent: config.botTokenPresent,
      appTokenPresent: config.appTokenPresent,
      allowedTeamIds: config.allowedTeamIds,
      dmsEnabled: config.enableDms,
      channelMentionsEnabled: config.enableChannelMentions,
      allowedChannelCount: config.allowedChannelIds.length,
      allowedUserCount: config.allowedUserIds.length,
      eventsEndpointUrl: config.eventsEndpointUrl,
      propertyCommandEndpointUrl: config.propertyCommandEndpointUrl,
      missingRequired: config.missingRequired,
    },
    stats,
    identity,
    search,
    activity,
  };
}

export async function runSlackAuthDiagnostic() {
  const result = await authTestSlack();
  return {
    ok: result.ok,
    error: result.error ?? null,
    team: result.team ?? null,
    user: result.user ?? null,
  };
}

export async function runSlackTestPost(input: { channelOrUserId: string; text?: string }) {
  const destination = input.channelOrUserId.trim();
  if (!destination) {
    throw new Error("A channel or user ID is required for a test post.");
  }
  const text =
    input.text?.trim() || "Baxter admin test message — ignore if you were not expecting this.";
  const result = await postSlackMessage({
    channel: destination,
    text: `*Baxter*\n${text}`,
  });
  return { ok: true, ts: result.ts ?? null };
}

export async function runSlackPipelineDryRun(question: string) {
  const result = await answerBaxterQuestion({
    question: question.trim() || "Who is Baxter?",
    userId: null,
    userName: "Slack admin dry-run",
    channel: "slack",
    externalThreadId: `admin-dry-run:${Date.now()}`,
    externalUserId: "admin-dry-run",
  });
  return {
    answer: result.answer,
    answerMode: result.answerMode ?? null,
    sources: result.sources.map((s) => ({
      title: s.title,
      sourceUrl: s.sourceUrl,
      openLabel: s.openLabel,
    })),
    formattedPreview: buildBaxterSlackText(result),
    conversationId: result.conversationId,
    errorCode: result.errorCode ?? null,
  };
}

export async function processOnePendingSlackJob() {
  const job = await claimNextJob({ jobTypes: ["slack_baxter_reply"] });
  if (!job) {
    return { processed: false, message: "No pending slack_baxter_reply jobs." };
  }
  const result = await processJob(job);
  return { processed: true, jobId: job.id, result };
}

export async function getSlackConversationDetail(conversationId: string) {
  const conversation = await getConversationForUser(conversationId, "slack-service", {
    allowSlackService: true,
  });
  if (!conversation || conversation.channel !== "slack") {
    return null;
  }

  const messages = await listMessagesForConversation(conversation.id);
  const parsed = parseSlackExternalThreadId(conversation.external_thread_id);
  const teamId = parsed.teamId;
  const channelId = parsed.channelId;
  const threadOrUser = parsed.threadOrUserKey;

  let userProfile =
    teamId && conversation.external_user_id
      ? await getCachedSlackUserProfile(teamId, conversation.external_user_id)
      : null;
  let channelProfile =
    teamId && channelId ? await getCachedSlackChannelProfile(teamId, channelId) : null;

  // Lazy resolve when missing (admin page only; bounded)
  try {
    if (
      teamId &&
      conversation.external_user_id &&
      !userProfile?.display_name &&
      !userProfile?.real_name
    ) {
      userProfile = await resolveSlackUserProfile({
        teamId,
        slackUserId: conversation.external_user_id,
      });
    }
  } catch {
    // ignore
  }
  try {
    if (teamId && channelId && !channelProfile?.name && !parsed.isDmKey) {
      channelProfile = await resolveSlackChannelProfile({ teamId, slackChannelId: channelId });
    }
  } catch {
    // ignore
  }

  const userLabel = formatResolvedUserLabel(userProfile, conversation.external_user_id);
  const channelLabel = formatResolvedChannelLabel(channelProfile, channelId);

  return {
    conversation,
    teamId,
    channelId,
    threadOrUser,
    isDm: parsed.isDmKey,
    userLabel,
    channelLabel,
    avatarUrl: userProfile?.avatar_url ?? null,
    messages: messages.map((message) => {
      const meta = message.metadata as {
        sources?: Array<{ title?: string; citationLabel?: string; sourceUrl?: string | null }>;
        answerMode?: string;
      };
      const isReset =
        message.role === "assistant" &&
        (message.model_provider === "command" || /conversation cleared/i.test(message.content));
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
        answerMode: meta.answerMode ?? null,
        confidence: message.confidence,
        errorCode: message.error_code,
        insufficientKnowledge: message.insufficient_knowledge,
        modelProvider: message.model_provider,
        modelName: message.model_name,
        latencyMs: message.latency_ms,
        sources: Array.isArray(meta.sources) ? meta.sources : [],
        isSystemReset: isReset,
        speakerLabel: message.role === "assistant" ? (isReset ? "System" : "Baxter") : userLabel,
      };
    }),
  };
}

export async function refreshSlackDisplayNames() {
  return backfillSlackDisplayNames({ limit: 80, force: true });
}

export async function verifyEventsConfigValues() {
  const config = getSlackRuntimeConfig();
  let envNode: string | null = null;
  try {
    envNode = getEnv().NODE_ENV ?? null;
  } catch {
    envNode = process.env.NODE_ENV ?? null;
  }

  let receiptsTableOk = false;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("slack_event_receipts").select("event_id").limit(1);
    receiptsTableOk = !error;
  } catch {
    receiptsTableOk = false;
  }

  return {
    enabled: config.enabled,
    readyForEvents: config.readyForEvents,
    missingRequired: config.missingRequired,
    eventsEndpointUrl: config.eventsEndpointUrl,
    propertyCommandEndpointUrl: config.propertyCommandEndpointUrl,
    allowedTeamIdsConfigured: config.allowedTeamIds.length > 0,
    allowedChannelsConfigured: config.allowedChannelIds.length > 0,
    dmsEnabled: config.enableDms,
    channelMentionsEnabled: config.enableChannelMentions,
    receiptsTableOk,
    nodeEnv: envNode,
  };
}
