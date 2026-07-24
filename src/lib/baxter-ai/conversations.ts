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
  userId: string;
  userName?: string | null;
  conversationId?: string | null;
  channel: "web" | "slack";
  externalThreadId?: string | null;
  externalUserId?: string | null;
}): Promise<BaxterConversation> {
  if (input.conversationId) {
    const existing = await getConversationForUser(input.conversationId, input.userId, {
      allowSlackService: input.channel === "slack",
    });
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
        (conversation) => conversation.external_thread_id === externalThreadId,
      ) ?? null
    );
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_conversations")
    .select("*")
    .eq("external_thread_id", externalThreadId)
    .eq("channel", "slack")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return (
        Array.from(getMemory().conversations.values()).find(
          (conversation) => conversation.external_thread_id === externalThreadId,
        ) ?? null
      );
    }
    throw error;
  }
  return (data as BaxterConversation | null) ?? null;
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
  };
  await persistMessage(message);
  await persistMessageSources(message.id, input.conversationId, input.sourceEntryIds);
  await touchConversation(input.conversationId, message.created_at);
  return message;
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

  const mapped = sources.map((source) => ({
    knowledge_entry_id: source.id,
    source_order: source.order,
    relevance_score: source.relevanceScore,
  }));

  if (shouldPersistInMemory(conversationId)) {
    getMemory().sources.set(messageId, mapped);
    return;
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("baxter_message_sources")
    .insert(mapped.map((row) => ({ ...row, message_id: messageId })));

  if (error) {
    // Missing table or missing knowledge FK — keep answering path working.
    getMemory().sources.set(messageId, mapped);
    if (!isMissingTableError(error) && error.code !== "23503") {
      console.warn("[baxter-ai] failed to persist message sources", error.message);
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
