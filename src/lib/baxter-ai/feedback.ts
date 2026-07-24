import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { getConversationForUser, listMessagesForConversation } from "@/lib/baxter-ai/conversations";

export type BaxterFeedbackRating = "up" | "down";

export type BaxterMessageFeedback = {
  id: string;
  message_id: string;
  conversation_id: string;
  user_id: string;
  rating: BaxterFeedbackRating;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryState = {
  feedback: Map<string, BaxterMessageFeedback>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterFeedbackMemory?: MemoryState;
};

function getMemory(): MemoryState {
  if (!globalMemory.__baxterFeedbackMemory) {
    globalMemory.__baxterFeedbackMemory = { feedback: new Map() };
  }
  return globalMemory.__baxterFeedbackMemory;
}

export function resetBaxterFeedbackMemoryForTests() {
  globalMemory.__baxterFeedbackMemory = { feedback: new Map() };
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function memoryKey(messageId: string, userId: string) {
  return `${messageId}:${userId}`;
}

export async function upsertMessageFeedback(input: {
  messageId: string;
  conversationId?: string | null;
  userId: string;
  rating: BaxterFeedbackRating;
  comment?: string | null;
}): Promise<BaxterMessageFeedback> {
  const messages = input.conversationId
    ? await listMessagesForConversation(input.conversationId)
    : null;

  const conversationId = input.conversationId ?? null;
  let message = messages?.find((m) => m.id === input.messageId && m.role === "assistant") ?? null;

  if (!message && !conversationId) {
    // Service lookup by message id via memory or supabase
    if (shouldUseMemory()) {
      throw new NotFoundError("Message not found");
    }
  }

  if (shouldUseMemory()) {
    if (!message) {
      // Scan memory conversations is expensive; require conversationId in memory mode tests
      if (!conversationId) throw new NotFoundError("Message not found");
      const listed = await listMessagesForConversation(conversationId);
      message = listed.find((m) => m.id === input.messageId && m.role === "assistant") ?? null;
    }
    if (!message) throw new NotFoundError("Message not found");

    const conversation = await getConversationForUser(message.conversation_id, input.userId);
    if (!conversation) throw new AuthorizationError("You cannot rate this message");

    const now = new Date().toISOString();
    const existing = getMemory().feedback.get(memoryKey(input.messageId, input.userId));
    const row: BaxterMessageFeedback = {
      id: existing?.id ?? randomUUID(),
      message_id: input.messageId,
      conversation_id: message.conversation_id,
      user_id: input.userId,
      rating: input.rating,
      comment: input.comment ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    getMemory().feedback.set(memoryKey(input.messageId, input.userId), row);
    return row;
  }

  const supabase = createServiceClient();
  const { data: messageRow, error: messageError } = await supabase
    .from("baxter_messages")
    .select("id, conversation_id, role")
    .eq("id", input.messageId)
    .maybeSingle();
  if (messageError) throw messageError;
  if (!messageRow || messageRow.role !== "assistant") {
    throw new NotFoundError("Message not found");
  }

  const conversation = await getConversationForUser(messageRow.conversation_id, input.userId);
  if (!conversation) throw new AuthorizationError("You cannot rate this message");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("baxter_message_feedback")
    .upsert(
      {
        message_id: input.messageId,
        conversation_id: messageRow.conversation_id,
        user_id: input.userId,
        rating: input.rating,
        comment: input.comment ?? null,
        updated_at: now,
      },
      { onConflict: "message_id,user_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as BaxterMessageFeedback;
}

export async function getFeedbackAdminSummary() {
  if (shouldUseMemory()) {
    const rows = Array.from(getMemory().feedback.values());
    const up = rows.filter((r) => r.rating === "up").length;
    const down = rows.filter((r) => r.rating === "down").length;
    return {
      positiveCount: up,
      negativeCount: down,
      recentNegative: rows
        .filter((r) => r.rating === "down")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          rating: r.rating,
          createdAt: r.created_at,
          messageId: r.message_id,
          conversationId: r.conversation_id,
          comment: r.comment,
        })),
    };
  }

  const supabase = createServiceClient();
  const [{ count: up }, { count: down }, { data: recent }] = await Promise.all([
    supabase
      .from("baxter_message_feedback")
      .select("*", { count: "exact", head: true })
      .eq("rating", "up"),
    supabase
      .from("baxter_message_feedback")
      .select("*", { count: "exact", head: true })
      .eq("rating", "down"),
    supabase
      .from("baxter_message_feedback")
      .select("id, rating, created_at, message_id, conversation_id, comment")
      .eq("rating", "down")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const enriched = await Promise.all(
    (recent ?? []).map(async (row) => {
      const messages = await listMessagesForConversation(row.conversation_id);
      const assistant = messages.find((m) => m.id === row.message_id);
      const userMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user" && m.created_at <= (assistant?.created_at ?? ""));
      const meta = (assistant?.metadata ?? {}) as {
        sources?: Array<{ citationLabel?: string }>;
        answerMode?: string;
      };
      return {
        id: row.id,
        rating: row.rating,
        createdAt: row.created_at,
        messageId: row.message_id,
        conversationId: row.conversation_id,
        comment: row.comment,
        questionExcerpt: (userMsg?.content ?? "").slice(0, 160),
        answerExcerpt: (assistant?.content ?? "").slice(0, 200),
        answerMode: meta.answerMode ?? null,
        sourceCount: Array.isArray(meta.sources) ? meta.sources.length : 0,
        errorCode: assistant?.error_code ?? null,
      };
    }),
  );

  return {
    positiveCount: up ?? 0,
    negativeCount: down ?? 0,
    recentNegative: enriched,
  };
}
