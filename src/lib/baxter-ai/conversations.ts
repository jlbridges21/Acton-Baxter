import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import type {
  BaxterAnswer,
  BaxterConfidence,
  BaxterConversation,
  BaxterMessage,
  BaxterSourceReference,
} from "./types";

type MemoryState = {
  conversations: Map<string, BaxterConversation>;
  messages: Map<string, BaxterMessage[]>;
  sources: Map<
    string,
    Array<{ knowledge_entry_id: string; source_order: number; relevance_score: number | null }>
  >;
  /** Conversations that only exist in-process (DB unavailable). */
  memoryOnlyIds: Set<string>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterConversationMemory?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterConversationMemory) {
    globalMemory.__baxterConversationMemory = {
      conversations: new Map(),
      messages: new Map(),
      sources: new Map(),
      memoryOnlyIds: new Set(),
    };
  }
  return globalMemory.__baxterConversationMemory;
}

export function resetBaxterConversationMemoryForTests() {
  globalMemory.__baxterConversationMemory = {
    conversations: new Map(),
    messages: new Map(),
    sources: new Map(),
    memoryOnlyIds: new Set(),
  };
}

function shouldUseMemoryStore(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  const message = (record.message ?? "").toLowerCase();
  return (
    record.code === "42P01" ||
    record.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function shouldPersistInMemory(conversationId: string): boolean {
  return shouldUseMemoryStore() || getMemory().memoryOnlyIds.has(conversationId);
}

export async function getOrCreateWebConversation(input: {
  userId: string;
  userName?: string | null;
  conversationId?: string | null;
}): Promise<BaxterConversation> {
  return getOrCreateConversation({
    ...input,
    channel: "web",
  });
}

export async function getOrCreateConversation(input: {
  userId: string | null;
  userName?: string | null;
  conversationId?: string | null;
  channel: "web" | "slack";
  externalThreadId?: string | null;
  externalUserId?: string | null;
}): Promise<BaxterConversation> {
  if (input.channel === "web" && !input.userId) {
    throw new AuthorizationError("Web conversations require an authenticated user");
  }

  if (input.conversationId) {
    if (!input.userId && input.channel !== "slack") {
      throw new AuthorizationError("Conversation lookup requires a user");
    }
    const existing = await getConversationForUser(
      input.conversationId,
      input.userId ?? "slack-service",
      {
        allowSlackService: input.channel === "slack",
      },
    );
    if (!existing) throw new NotFoundError("Conversation not found");
    return existing;
  }

  if (input.channel === "slack" && input.externalThreadId) {
    const byThread = await findConversationByExternalThread(input.externalThreadId);
    if (byThread) return byThread;
  }

  const conversation: BaxterConversation = {
    id: randomUUID(),
    channel: input.channel,
    external_thread_id: input.externalThreadId ?? null,
    user_id: input.userId,
    external_user_id: input.externalUserId ?? null,
    user_display_name: input.userName ?? null,
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
    last_message_at: null,
    metadata: {},
  };

  if (shouldUseMemoryStore()) {
    getMemory().conversations.set(conversation.id, conversation);
    getMemory().messages.set(conversation.id, []);
    getMemory().memoryOnlyIds.add(conversation.id);
    return conversation;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_conversations")
    .insert({
      id: conversation.id,
      channel: conversation.channel,
      user_id: conversation.user_id,
      user_display_name: conversation.user_display_name,
      external_thread_id: conversation.external_thread_id,
      external_user_id: conversation.external_user_id,
      status: conversation.status,
      metadata: {},
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      getMemory().conversations.set(conversation.id, conversation);
      getMemory().messages.set(conversation.id, []);
      getMemory().memoryOnlyIds.add(conversation.id);
      return conversation;
    }
    throw error;
  }

  return data as BaxterConversation;
}

async function findConversationByExternalThread(
  externalThreadId: string,
): Promise<BaxterConversation | null> {
  if (shouldUseMemoryStore()) {
    return (
      Array.from(getMemory().conversations.values()).find(
        (conversation) =>
          conversation.external_thread_id === externalThreadId && conversation.status === "active",
      ) ?? null
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_conversations")
    .select("*")
    .eq("external_thread_id", externalThreadId)
    .eq("channel", "slack")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return (
        Array.from(getMemory().conversations.values()).find(
          (conversation) =>
            conversation.external_thread_id === externalThreadId &&
            conversation.status === "active",
        ) ?? null
      );
    }
    throw error;
  }
  return (data as BaxterConversation | null) ?? null;
}

/**
 * Close the current conversation and start a fresh one (Prompt 3 /clear).
 * Prior messages remain stored for admin diagnostics.
 */
export async function resetBaxterConversation(input: {
  previousConversationId?: string | null;
  userId: string | null;
  userName?: string | null;
  channel: "web" | "slack";
  externalThreadId?: string | null;
  externalUserId?: string | null;
}): Promise<{
  previousConversationId: string | null;
  conversation: BaxterConversation;
}> {
  const previousId = input.previousConversationId ?? null;
  let previousExternal: string | null = input.externalThreadId ?? null;

  if (previousId) {
    const previous = await getConversationForUser(previousId, input.userId ?? "slack-service", {
      allowSlackService: input.channel === "slack",
    }).catch(() => null);
    if (previous) {
      previousExternal = previous.external_thread_id ?? previousExternal;
      await closeConversationForReset(previous, {
        resetBy: input.userId ?? input.externalUserId ?? "unknown",
        channel: input.channel,
      });
    }
  } else if (input.channel === "slack" && input.externalThreadId) {
    const byThread = await findConversationByExternalThread(input.externalThreadId);
    if (byThread) {
      await closeConversationForReset(byThread, {
        resetBy: input.externalUserId ?? "unknown",
        channel: "slack",
      });
    }
  }

  const conversation = await getOrCreateConversation({
    userId: input.userId,
    userName: input.userName,
    channel: input.channel,
    externalThreadId: previousExternal,
    externalUserId: input.externalUserId,
    // Force create — do not reuse closed conversationId
    conversationId: null,
  });

  // Audit metadata on the new conversation
  conversation.metadata = {
    ...(conversation.metadata ?? {}),
    conversation_reset_at: nowIso(),
    previous_conversation_id: previousId,
    reset_channel: input.channel,
  };
  await patchConversationMetadata(conversation.id, conversation.metadata);

  return { previousConversationId: previousId, conversation };
}

async function closeConversationForReset(
  conversation: BaxterConversation,
  meta: { resetBy: string; channel: string },
): Promise<void> {
  const updated: BaxterConversation = {
    ...conversation,
    status: "closed",
    updated_at: nowIso(),
    metadata: {
      ...(conversation.metadata ?? {}),
      conversation_reset_at: nowIso(),
      reset_by: meta.resetBy,
      reset_channel: meta.channel,
    },
  };
  getMemory().conversations.set(conversation.id, updated);

  if (shouldPersistInMemory(conversation.id)) return;

  try {
    const supabase = createServiceClient();
    // Relinquish external_thread_id so a new active conversation can reuse it
    await supabase
      .from("baxter_conversations")
      .update({
        status: "closed",
        external_thread_id: conversation.external_thread_id
          ? `${conversation.external_thread_id}:closed:${Date.now()}`
          : null,
        metadata: updated.metadata,
        updated_at: updated.updated_at,
      })
      .eq("id", conversation.id);
  } catch {
    // best-effort
  }
}

async function patchConversationMetadata(
  conversationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const existing = getMemory().conversations.get(conversationId);
  if (existing) {
    getMemory().conversations.set(conversationId, { ...existing, metadata });
  }
  if (shouldPersistInMemory(conversationId)) return;
  try {
    const supabase = createServiceClient();
    await supabase.from("baxter_conversations").update({ metadata }).eq("id", conversationId);
  } catch {
    // ignore
  }
}

/** Public helper for PEM/GHL conversation context persistence. */
export async function updateBaxterConversationMetadata(
  conversationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await patchConversationMetadata(conversationId, metadata);
}

/** Service/admin lookup — no ownership check. */
export async function getConversationById(
  conversationId: string,
): Promise<BaxterConversation | null> {
  const mem = getMemory().conversations.get(conversationId);
  if (mem) return mem;
  if (shouldUseMemoryStore()) return null;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("baxter_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return getMemory().conversations.get(conversationId) ?? null;
      throw error;
    }
    return (data as BaxterConversation | null) ?? null;
  } catch (error) {
    if (isMissingTableError(error)) return getMemory().conversations.get(conversationId) ?? null;
    throw error;
  }
}

export async function getConversationForUser(
  conversationId: string,
  userId: string,
  options?: { allowSlackService?: boolean },
): Promise<BaxterConversation | null> {
  if (shouldPersistInMemory(conversationId)) {
    const conversation = getMemory().conversations.get(conversationId) ?? null;
    if (!conversation) return null;
    if (conversation.user_id !== userId && !options?.allowSlackService) {
      throw new AuthorizationError("You cannot continue another employee’s conversation");
    }
    return conversation;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const conversation = getMemory().conversations.get(conversationId) ?? null;
      if (conversation && conversation.user_id !== userId && !options?.allowSlackService) {
        throw new AuthorizationError("You cannot continue another employee’s conversation");
      }
      return conversation;
    }
    throw error;
  }
  if (!data) return null;

  const conversation = data as BaxterConversation;
  if (
    conversation.user_id !== userId &&
    !(options?.allowSlackService && conversation.channel === "slack")
  ) {
    throw new AuthorizationError("You cannot continue another employee’s conversation");
  }
  return conversation;
}

export async function listRecentConversations(limit = 30): Promise<BaxterConversation[]> {
  if (shouldUseMemoryStore()) {
    return Array.from(getMemory().conversations.values())
      .sort((a, b) =>
        (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at),
      )
      .slice(0, limit);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_conversations")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data as BaxterConversation[]) ?? [];
}

export async function listMessagesForConversation(
  conversationId: string,
): Promise<BaxterMessage[]> {
  if (shouldPersistInMemory(conversationId)) {
    return getMemory().messages.get(conversationId) ?? [];
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return getMemory().messages.get(conversationId) ?? [];
    throw error;
  }
  return (data as BaxterMessage[]) ?? [];
}

export async function appendUserMessage(input: {
  conversationId: string;
  content: string;
}): Promise<BaxterMessage> {
  const message: BaxterMessage = {
    id: randomUUID(),
    conversation_id: input.conversationId,
    role: "user",
    content: input.content,
    insufficient_knowledge: false,
    confidence: null,
    model_provider: null,
    model_name: null,
    slack_channel_id: null,
    slack_message_ts: null,
    input_tokens: null,
    output_tokens: null,
    latency_ms: null,
    error_code: null,
    created_at: nowIso(),
    metadata: {},
  };
  await persistMessage(message);
  await touchConversation(input.conversationId, message.created_at);
  return message;
}

export async function appendAssistantMessage(input: {
  conversationId: string;
  content: string;
  insufficientKnowledge: boolean;
  confidence: BaxterConfidence;
  modelProvider: string | null;
  modelName: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  sources: BaxterSourceReference[];
  sourceEntryIds: Array<{ id: string; relevanceScore: number | null; order: number }>;
}): Promise<BaxterMessage> {
  const message: BaxterMessage = {
    id: randomUUID(),
    conversation_id: input.conversationId,
    role: "assistant",
    content: input.content,
    insufficient_knowledge: input.insufficientKnowledge,
    confidence: input.confidence,
    model_provider: input.modelProvider,
    model_name: input.modelName,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    latency_ms: input.latencyMs ?? null,
    error_code: input.errorCode ?? null,
    created_at: nowIso(),
    metadata: { sources: input.sources },
    slack_channel_id: null,
    slack_message_ts: null,
  };
  await persistMessage(message);
  await persistMessageSources(message.id, input.conversationId, input.sourceEntryIds);
  await touchConversation(input.conversationId, message.created_at);
  return message;
}

/**
 * Attach the Slack channel + message ts of a posted Baxter reply so reactions
 * can resolve back to this assistant message.
 */
export async function attachSlackMessageRef(input: {
  messageId: string;
  slackChannelId: string;
  slackMessageTs: string;
}): Promise<void> {
  const channelId = input.slackChannelId.trim();
  const messageTs = input.slackMessageTs.trim();
  if (!input.messageId || !channelId || !messageTs) return;

  // Memory path: update any in-process message matching the id.
  for (const [conversationId, list] of getMemory().messages.entries()) {
    const idx = list.findIndex((m) => m.id === input.messageId);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = {
        ...next[idx]!,
        slack_channel_id: channelId,
        slack_message_ts: messageTs,
      };
      getMemory().messages.set(conversationId, next);
      if (shouldPersistInMemory(conversationId)) return;
      break;
    }
  }

  if (shouldUseMemoryStore()) {
    return;
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("baxter_messages")
      .update({
        slack_channel_id: channelId,
        slack_message_ts: messageTs,
      })
      .eq("id", input.messageId);
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) return;
      throw error;
    }
  } catch (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return;
    throw error;
  }
}

/** Resolve a Slack reaction target to a Baxter assistant message, if any. */
export async function findAssistantMessageBySlackRef(input: {
  slackChannelId: string;
  slackMessageTs: string;
}): Promise<BaxterMessage | null> {
  const channelId = input.slackChannelId.trim();
  const messageTs = input.slackMessageTs.trim();
  if (!channelId || !messageTs) return null;

  for (const list of getMemory().messages.values()) {
    const hit = list.find(
      (m) =>
        m.role === "assistant" &&
        m.slack_channel_id === channelId &&
        m.slack_message_ts === messageTs,
    );
    if (hit) return hit;
  }

  if (shouldUseMemoryStore()) return null;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("baxter_messages")
      .select("*")
      .eq("slack_channel_id", channelId)
      .eq("slack_message_ts", messageTs)
      .eq("role", "assistant")
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) return null;
      throw error;
    }
    return (data as BaxterMessage | null) ?? null;
  } catch (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return null;
    throw error;
  }
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "42703" || /column .* does not exist/i.test(message);
}

async function persistMessage(message: BaxterMessage) {
  if (shouldPersistInMemory(message.conversation_id)) {
    const list = getMemory().messages.get(message.conversation_id) ?? [];
    list.push(message);
    getMemory().messages.set(message.conversation_id, list);
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("baxter_messages").insert({
    id: message.id,
    conversation_id: message.conversation_id,
    role: message.role,
    content: message.content,
    insufficient_knowledge: message.insufficient_knowledge,
    confidence: message.confidence,
    model_provider: message.model_provider,
    model_name: message.model_name,
    input_tokens: message.input_tokens,
    output_tokens: message.output_tokens,
    latency_ms: message.latency_ms,
    error_code: message.error_code,
    metadata: message.metadata,
    slack_channel_id: message.slack_channel_id ?? null,
    slack_message_ts: message.slack_message_ts ?? null,
  });

  if (error) {
    if (isMissingTableError(error)) {
      getMemory().memoryOnlyIds.add(message.conversation_id);
      const list = getMemory().messages.get(message.conversation_id) ?? [];
      list.push(message);
      getMemory().messages.set(message.conversation_id, list);
      return;
    }
    throw error;
  }
}

async function persistMessageSources(
  messageId: string,
  conversationId: string,
  sources: Array<{ id: string; relevanceScore: number | null; order: number }>,
) {
  if (sources.length === 0) return;

  let snapshots = new Map<
    string,
    {
      title: string | null;
      sourceType: string | null;
      sourceUrl: string | null;
      label: string | null;
    }
  >();
  try {
    const { getKnowledgeEntry } = await import("@/lib/knowledge/store");
    for (const source of sources) {
      const entry = await getKnowledgeEntry(source.id);
      if (entry) {
        snapshots.set(source.id, {
          title: entry.title,
          sourceType: entry.source_type,
          sourceUrl: entry.source_url,
          label: entry.source_name || entry.title,
        });
      }
    }
  } catch {
    snapshots = new Map();
  }

  const mapped = sources.map((source) => {
    const snap = snapshots.get(source.id);
    return {
      knowledge_entry_id: source.id,
      source_order: source.order,
      relevance_score: source.relevanceScore,
      source_title_snapshot: snap?.title ?? null,
      source_type_snapshot: snap?.sourceType ?? null,
      source_url_snapshot: snap?.sourceUrl ?? null,
      source_label_snapshot: snap?.label ?? null,
    };
  });

  if (shouldPersistInMemory(conversationId)) {
    getMemory().sources.set(
      messageId,
      mapped.map((row) => ({
        knowledge_entry_id: row.knowledge_entry_id,
        source_order: row.source_order,
        relevance_score: row.relevance_score,
      })),
    );
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("baxter_message_sources")
    .insert(mapped.map((row) => ({ ...row, message_id: messageId })));

  if (error) {
    // Retry without snapshot columns if migration 015 not applied yet
    const fallback = await supabase.from("baxter_message_sources").insert(
      mapped.map((row) => ({
        message_id: messageId,
        knowledge_entry_id: row.knowledge_entry_id,
        source_order: row.source_order,
        relevance_score: row.relevance_score,
      })),
    );
    if (fallback.error) {
      getMemory().sources.set(
        messageId,
        mapped.map((row) => ({
          knowledge_entry_id: row.knowledge_entry_id,
          source_order: row.source_order,
          relevance_score: row.relevance_score,
        })),
      );
      if (!isMissingTableError(fallback.error) && fallback.error.code !== "23503") {
        console.warn("[baxter-ai] failed to persist message sources", fallback.error.message);
      }
    }
  }
}

async function touchConversation(conversationId: string, lastMessageAt: string) {
  const memoryConversation = getMemory().conversations.get(conversationId);
  if (memoryConversation) {
    memoryConversation.last_message_at = lastMessageAt;
    memoryConversation.updated_at = lastMessageAt;
    getMemory().conversations.set(conversationId, memoryConversation);
  }

  if (shouldPersistInMemory(conversationId)) return;

  const supabase = createServiceClient();
  await supabase
    .from("baxter_conversations")
    .update({ last_message_at: lastMessageAt, updated_at: lastMessageAt })
    .eq("id", conversationId);
}

export function toPublicAnswer(input: {
  conversationId: string;
  messageId: string;
  answer: string;
  sources: BaxterSourceReference[];
  confidence: BaxterConfidence;
  insufficientKnowledge: boolean;
  answerMode?: BaxterAnswer["answerMode"];
  errorCode?: string | null;
}): BaxterAnswer {
  return {
    answer: input.answer,
    sources: input.sources,
    confidence: input.confidence,
    insufficientKnowledge: input.insufficientKnowledge,
    conversationId: input.conversationId,
    messageId: input.messageId,
    answerMode: input.answerMode,
    errorCode: input.errorCode ?? null,
  };
}

export async function getRecentConversationHistory(
  conversationId: string,
  options?: { limit?: number; excludeLastUser?: boolean },
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const limit = options?.limit ?? 10;
  const messages = await listMessagesForConversation(conversationId);
  const usable = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      !message.error_code &&
      message.content.trim().length > 0,
  );
  const sliced = usable.slice(-limit - (options?.excludeLastUser ? 1 : 0));
  // Exclude the just-appended current user message when requested
  const withoutCurrent =
    options?.excludeLastUser && sliced.length > 0 && sliced[sliced.length - 1]?.role === "user"
      ? sliced.slice(0, -1)
      : sliced;
  return withoutCurrent.map((message) => ({
    role: message.role as "user" | "assistant",
    content:
      message.content.length > 1200
        ? `${message.content.slice(0, 1199).trimEnd()}…`
        : message.content,
  }));
}
