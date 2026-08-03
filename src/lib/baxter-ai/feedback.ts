import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  getConversationById,
  getConversationForUser,
  listMessagesForConversation,
} from "@/lib/baxter-ai/conversations";
import { pickSlackDisplayName, slackUserFallbackLabel } from "@/lib/slack/display-names";
import type { BaxterFeedbackChannel, BaxterFeedbackRating } from "./feedback-types";
import {
  inDateRange,
  type DateRangeBounds,
  type FeedbackSortDirection,
} from "./feedback-date-ranges";

export type { BaxterFeedbackChannel, BaxterFeedbackRating } from "./feedback-types";
export type {
  DateRangeBounds,
  FeedbackRangePreset,
  FeedbackSortDirection,
} from "./feedback-date-ranges";
export {
  BAXTER_REPORTING_TIMEZONE,
  resolveFeedbackDateRange,
  parseFeedbackRangePreset,
} from "./feedback-date-ranges";

export type BaxterMessageFeedback = {
  id: string;
  message_id: string;
  conversation_id: string;
  user_id: string | null;
  slack_user_id: string | null;
  slack_team_id: string | null;
  rating: BaxterFeedbackRating;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type BaxterAdminFeedbackRow = {
  id: string;
  rating: BaxterFeedbackRating;
  createdAt: string;
  channel: BaxterFeedbackChannel;
  messageId: string;
  conversationId: string;
  comment: string | null;
  questionExcerpt: string;
  answerExcerpt: string;
  commenterLabel: string;
  answerMode: string | null;
  sourceCount: number;
  errorCode: string | null;
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

/** Test/admin helper: all in-memory feedback rows. */
export function getFeedbackMemoryRowsForTests(): BaxterMessageFeedback[] {
  return Array.from(getMemory().feedback.values());
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function memoryKeyForUser(messageId: string, userId: string) {
  return `user:${messageId}:${userId}`;
}

function memoryKeyForSlack(messageId: string, slackUserId: string) {
  return `slack:${messageId}:${slackUserId}`;
}

/** Application-level mirror of the DB actor check constraint. */
export function assertFeedbackActor(input: {
  userId?: string | null;
  slackUserId?: string | null;
}): void {
  if (!input.userId && !input.slackUserId) {
    throw new ValidationError("Feedback requires user_id or slack_user_id");
  }
}

export async function upsertMessageFeedback(input: {
  messageId: string;
  conversationId?: string | null;
  userId: string;
  rating: BaxterFeedbackRating;
  comment?: string | null;
}): Promise<BaxterMessageFeedback> {
  assertFeedbackActor({ userId: input.userId });

  const messages = input.conversationId
    ? await listMessagesForConversation(input.conversationId)
    : null;

  const conversationId = input.conversationId ?? null;
  let message = messages?.find((m) => m.id === input.messageId && m.role === "assistant") ?? null;

  if (!message && !conversationId) {
    if (shouldUseMemory()) {
      throw new NotFoundError("Message not found");
    }
  }

  if (shouldUseMemory()) {
    if (!message) {
      if (!conversationId) throw new NotFoundError("Message not found");
      const listed = await listMessagesForConversation(conversationId);
      message = listed.find((m) => m.id === input.messageId && m.role === "assistant") ?? null;
    }
    if (!message) throw new NotFoundError("Message not found");

    const conversation = await getConversationForUser(message.conversation_id, input.userId);
    if (!conversation) throw new AuthorizationError("You cannot rate this message");

    const now = new Date().toISOString();
    const key = memoryKeyForUser(input.messageId, input.userId);
    const existing = getMemory().feedback.get(key);
    const row: BaxterMessageFeedback = {
      id: existing?.id ?? randomUUID(),
      message_id: input.messageId,
      conversation_id: message.conversation_id,
      user_id: input.userId,
      slack_user_id: null,
      slack_team_id: null,
      rating: input.rating,
      comment: input.comment ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    getMemory().feedback.set(key, row);
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

  // Select-then-update/insert: partial unique indexes are unreliable with PostgREST onConflict.
  const { data: existing, error: existingError } = await supabase
    .from("baxter_message_feedback")
    .select("*")
    .eq("message_id", input.messageId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingError) throw existingError;

  const now = new Date().toISOString();
  if (existing?.id) {
    const { data, error } = await supabase
      .from("baxter_message_feedback")
      .update({
        rating: input.rating,
        comment: input.comment ?? null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return normalizeFeedbackRow(data);
  }

  const { data, error } = await supabase
    .from("baxter_message_feedback")
    .insert({
      message_id: input.messageId,
      conversation_id: messageRow.conversation_id,
      user_id: input.userId,
      slack_user_id: null,
      slack_team_id: null,
      rating: input.rating,
      comment: input.comment ?? null,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return normalizeFeedbackRow(data);
}

/**
 * Upsert feedback from a Slack reactor (service-role path; no Supabase profile required).
 * Dedupes on (message_id, slack_user_id).
 */
export async function upsertSlackMessageFeedback(input: {
  messageId: string;
  conversationId: string;
  slackUserId: string;
  slackTeamId?: string | null;
  rating: BaxterFeedbackRating;
  comment?: string | null;
  /** When true, leave an existing comment unchanged if input.comment is null/undefined. */
  preserveCommentIfUnset?: boolean;
}): Promise<BaxterMessageFeedback> {
  assertFeedbackActor({ slackUserId: input.slackUserId });

  if (shouldUseMemory()) {
    const listed = await listMessagesForConversation(input.conversationId);
    const message = listed.find((m) => m.id === input.messageId && m.role === "assistant");
    if (!message) throw new NotFoundError("Message not found");

    const now = new Date().toISOString();
    const key = memoryKeyForSlack(input.messageId, input.slackUserId);
    const existing = getMemory().feedback.get(key);
    const comment =
      input.comment !== undefined && input.comment !== null
        ? input.comment
        : input.preserveCommentIfUnset
          ? (existing?.comment ?? null)
          : null;
    const row: BaxterMessageFeedback = {
      id: existing?.id ?? randomUUID(),
      message_id: input.messageId,
      conversation_id: message.conversation_id,
      user_id: null,
      slack_user_id: input.slackUserId,
      slack_team_id: input.slackTeamId ?? existing?.slack_team_id ?? null,
      rating: input.rating,
      comment,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    getMemory().feedback.set(key, row);
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

  const { data: existing, error: existingError } = await supabase
    .from("baxter_message_feedback")
    .select("*")
    .eq("message_id", input.messageId)
    .eq("slack_user_id", input.slackUserId)
    .maybeSingle();
  if (existingError) throw existingError;

  const now = new Date().toISOString();
  const comment =
    input.comment !== undefined && input.comment !== null
      ? input.comment
      : input.preserveCommentIfUnset
        ? ((existing?.comment as string | null | undefined) ?? null)
        : null;

  if (existing?.id) {
    const { data, error } = await supabase
      .from("baxter_message_feedback")
      .update({
        rating: input.rating,
        comment,
        slack_team_id: input.slackTeamId ?? existing.slack_team_id ?? null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return normalizeFeedbackRow(data);
  }

  const { data, error } = await supabase
    .from("baxter_message_feedback")
    .insert({
      message_id: input.messageId,
      conversation_id: messageRow.conversation_id,
      user_id: null,
      slack_user_id: input.slackUserId,
      slack_team_id: input.slackTeamId ?? null,
      rating: input.rating,
      comment,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  return normalizeFeedbackRow(data);
}

export async function updateSlackFeedbackComment(input: {
  feedbackId: string;
  slackUserId: string;
  comment: string;
}): Promise<BaxterMessageFeedback> {
  if (shouldUseMemory()) {
    for (const [key, row] of getMemory().feedback.entries()) {
      if (row.id === input.feedbackId && row.slack_user_id === input.slackUserId) {
        const next: BaxterMessageFeedback = {
          ...row,
          comment: input.comment,
          updated_at: new Date().toISOString(),
        };
        getMemory().feedback.set(key, next);
        return next;
      }
    }
    throw new NotFoundError("Feedback not found");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("baxter_message_feedback")
    .update({
      comment: input.comment,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.feedbackId)
    .eq("slack_user_id", input.slackUserId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Feedback not found");
  return normalizeFeedbackRow(data);
}

export async function deleteSlackMessageFeedback(input: {
  messageId: string;
  slackUserId: string;
  rating?: BaxterFeedbackRating;
}): Promise<boolean> {
  if (shouldUseMemory()) {
    const key = memoryKeyForSlack(input.messageId, input.slackUserId);
    const existing = getMemory().feedback.get(key);
    if (!existing) return false;
    if (input.rating && existing.rating !== input.rating) return false;
    getMemory().feedback.delete(key);
    return true;
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("baxter_message_feedback")
    .delete()
    .eq("message_id", input.messageId)
    .eq("slack_user_id", input.slackUserId);
  if (input.rating) {
    query = query.eq("rating", input.rating);
  }
  const { data, error } = await query.select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

function normalizeFeedbackRow(data: unknown): BaxterMessageFeedback {
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    message_id: String(row.message_id),
    conversation_id: String(row.conversation_id),
    user_id: (row.user_id as string | null) ?? null,
    slack_user_id: (row.slack_user_id as string | null) ?? null,
    slack_team_id: (row.slack_team_id as string | null) ?? null,
    rating: row.rating as BaxterFeedbackRating,
    comment: (row.comment as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function enrichFeedbackRows(
  rows: BaxterMessageFeedback[],
): Promise<BaxterAdminFeedbackRow[]> {
  const supabase = shouldUseMemory() ? null : createServiceClient();
  const profileCache = new Map<string, string>();
  const slackNameCache = new Map<string, string>();

  return Promise.all(
    rows.map(async (row) => {
      let channel: BaxterFeedbackChannel = row.slack_user_id ? "slack" : "web";
      let questionExcerpt = "";
      let answerExcerpt = "";
      let answerMode: string | null = null;
      let sourceCount = 0;
      let errorCode: string | null = null;

      try {
        const conversation = await getConversationById(row.conversation_id);
        if (conversation?.channel === "web" || conversation?.channel === "slack") {
          channel = conversation.channel;
        }

        const messages = await listMessagesForConversation(row.conversation_id);
        const assistant = messages.find((m) => m.id === row.message_id);
        const userMsg = [...messages]
          .reverse()
          .find((m) => m.role === "user" && m.created_at <= (assistant?.created_at ?? ""));
        const meta = (assistant?.metadata ?? {}) as {
          sources?: Array<{ citationLabel?: string }>;
          answerMode?: string;
        };
        questionExcerpt = (userMsg?.content ?? "").slice(0, 200);
        answerExcerpt = (assistant?.content ?? "").slice(0, 240);
        answerMode = meta.answerMode ?? null;
        sourceCount = Array.isArray(meta.sources) ? meta.sources.length : 0;
        errorCode = assistant?.error_code ?? null;
      } catch {
        // Keep excerpts empty on enrichment failure
      }

      let commenterLabel = "Unknown";
      if (row.user_id) {
        if (profileCache.has(row.user_id)) {
          commenterLabel = profileCache.get(row.user_id)!;
        } else if (supabase) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", row.user_id)
            .maybeSingle();
          commenterLabel = (profile?.full_name as string | undefined)?.trim() || "Web user";
          profileCache.set(row.user_id, commenterLabel);
        } else {
          commenterLabel = "Web user";
        }
      } else if (row.slack_user_id) {
        const cacheKey = `${row.slack_team_id ?? ""}:${row.slack_user_id}`;
        if (slackNameCache.has(cacheKey)) {
          commenterLabel = slackNameCache.get(cacheKey)!;
        } else if (supabase && row.slack_team_id) {
          const { data: slackProfile } = await supabase
            .from("slack_user_profiles")
            .select("display_name, real_name, username, slack_user_id")
            .eq("team_id", row.slack_team_id)
            .eq("slack_user_id", row.slack_user_id)
            .maybeSingle();
          commenterLabel = slackProfile
            ? pickSlackDisplayName(slackProfile)
            : slackUserFallbackLabel(row.slack_user_id);
          slackNameCache.set(cacheKey, commenterLabel);
        } else {
          commenterLabel = slackUserFallbackLabel(row.slack_user_id);
          slackNameCache.set(cacheKey, commenterLabel);
        }
      }

      return {
        id: row.id,
        rating: row.rating,
        createdAt: row.created_at,
        channel,
        messageId: row.message_id,
        conversationId: row.conversation_id,
        comment: row.comment,
        questionExcerpt,
        answerExcerpt,
        commenterLabel,
        answerMode,
        sourceCount,
        errorCode,
      };
    }),
  );
}

function applyCreatedAtRange<
  T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T },
>(query: T, range: DateRangeBounds | undefined): T {
  let next = query;
  if (range?.start) next = next.gte("created_at", range.start);
  if (range?.end) next = next.lte("created_at", range.end);
  return next;
}

export async function listFeedbackForAdmin(input?: {
  rating?: "all" | BaxterFeedbackRating;
  limit?: number;
  offset?: number;
  /** ISO created_at bounds on feedback rows; omit/null ends = unbounded (all time). */
  range?: DateRangeBounds | null;
  sort?: FeedbackSortDirection;
}): Promise<{
  rows: BaxterAdminFeedbackRow[];
  positiveCount: number;
  negativeCount: number;
  totalMatching: number;
}> {
  const rating = input?.rating ?? "all";
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 100);
  const offset = Math.max(input?.offset ?? 0, 0);
  const sort: FeedbackSortDirection = input?.sort ?? "newest";
  const range: DateRangeBounds = input?.range ?? { start: null, end: null };
  const ascending = sort === "oldest";

  if (shouldUseMemory()) {
    const all = Array.from(getMemory().feedback.values()).filter((r) =>
      inDateRange(r.created_at, range),
    );
    // Counts of rating rows in range (not distinct messages — multiple raters possible).
    const positiveCount = all.filter((r) => r.rating === "up").length;
    const negativeCount = all.filter((r) => r.rating === "down").length;
    const filtered = rating === "all" ? all : all.filter((r) => r.rating === rating);
    const sorted = filtered.sort((a, b) =>
      ascending
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
    const page = sorted.slice(offset, offset + limit);
    const rows = await enrichFeedbackRows(page);
    return {
      rows,
      positiveCount,
      negativeCount,
      totalMatching: filtered.length,
    };
  }

  const supabase = createServiceClient();
  let upQuery = supabase
    .from("baxter_message_feedback")
    .select("*", { count: "exact", head: true })
    .eq("rating", "up");
  upQuery = applyCreatedAtRange(upQuery, range);

  let downQuery = supabase
    .from("baxter_message_feedback")
    .select("*", { count: "exact", head: true })
    .eq("rating", "down");
  downQuery = applyCreatedAtRange(downQuery, range);

  const [{ count: up }, { count: down }] = await Promise.all([upQuery, downQuery]);

  let listQuery = supabase
    .from("baxter_message_feedback")
    .select("*", { count: "exact" })
    .order("created_at", { ascending })
    .range(offset, offset + limit - 1);
  listQuery = applyCreatedAtRange(listQuery, range);
  if (rating === "up" || rating === "down") {
    listQuery = listQuery.eq("rating", rating);
  }

  const { data, error, count } = await listQuery;
  if (error) throw error;

  const rows = await enrichFeedbackRows((data ?? []).map(normalizeFeedbackRow));
  return {
    rows,
    positiveCount: up ?? 0,
    negativeCount: down ?? 0,
    totalMatching: count ?? rows.length,
  };
}

/**
 * Count Baxter assistant replies (inquiries answered) in a created_at range.
 * Channel breakdown is via baxter_conversations.channel.
 */
export async function getBaxterInquiryCount(range: DateRangeBounds): Promise<{
  total: number;
  byChannel: { web: number; slack: number };
}> {
  const { listInquiriesForAdmin } = await import("./feedback-inquiries");
  const listed = await listInquiriesForAdmin({
    range,
    channel: "all",
    rating: "all",
    limit: 1,
    offset: 0,
  });
  return {
    total: listed.totalInquiries,
    byChannel: listed.channelBreakdown,
  };
}

export type FeedbackDashboardResult = {
  totalInquiries: number;
  /** Distinct inquiries whose summarized rating is positive. */
  positiveCount: number;
  /** Distinct inquiries whose summarized rating is negative (down wins over mixed). */
  negativeCount: number;
  /** Distinct inquiries with no feedback rows. */
  noFeedbackCount: number;
  rows: import("./feedback-inquiries").BaxterInquiryAdminRow[];
  totalMatchingRows: number;
  channelBreakdown: { web: number; slack: number };
  range: DateRangeBounds;
  askerOptions: import("./feedback-inquiries").FeedbackAskerOption[];
  departmentOptions: string[];
};

export async function getFeedbackDashboard(input?: {
  rating?: "all" | "positive" | "negative" | "none";
  channel?: "all" | "web" | "slack";
  askerKey?: string | null;
  department?: string | null;
  limit?: number;
  offset?: number;
  range?: DateRangeBounds | null;
  sort?: FeedbackSortDirection;
}): Promise<FeedbackDashboardResult> {
  const range: DateRangeBounds = input?.range ?? { start: null, end: null };
  const { listInquiriesForAdmin, listFeedbackAskerOptions, listFeedbackDepartmentOptions } =
    await import("./feedback-inquiries");

  const [listed, askerOptions, departmentOptions] = await Promise.all([
    listInquiriesForAdmin({
      rating: input?.rating ?? "all",
      channel: input?.channel ?? "all",
      askerKey: input?.askerKey,
      department: input?.department,
      limit: input?.limit,
      offset: input?.offset,
      range,
      sort: input?.sort ?? "newest",
    }),
    listFeedbackAskerOptions(),
    listFeedbackDepartmentOptions(),
  ]);

  return {
    totalInquiries: listed.totalInquiries,
    positiveCount: listed.positiveCount,
    negativeCount: listed.negativeCount,
    noFeedbackCount: listed.noFeedbackCount,
    rows: listed.rows,
    totalMatchingRows: listed.totalMatching,
    channelBreakdown: listed.channelBreakdown,
    range,
    askerOptions,
    departmentOptions,
  };
}

export async function getFeedbackAdminSummary() {
  const dashboard = await getFeedbackDashboard({
    rating: "negative",
    limit: 20,
    offset: 0,
    range: { start: null, end: null },
  });
  return {
    positiveCount: dashboard.positiveCount,
    negativeCount: dashboard.negativeCount,
    recentNegative: dashboard.rows.map((r) => ({
      id: r.messageId,
      rating: "down" as const,
      createdAt: r.createdAt,
      messageId: r.messageId,
      conversationId: r.conversationId,
      comment:
        r.feedbackEntries
          .map((e) => e.comment)
          .filter(Boolean)
          .join("\n\n") || null,
      questionExcerpt: r.questionExcerpt,
      answerExcerpt: r.answerExcerpt,
      answerMode: r.answerMode,
      sourceCount: r.sourceCount,
      errorCode: r.errorCode,
    })),
  };
}
