/**
 * Inquiry-based Baxter feedback reporting.
 * Primary entity = assistant messages (all answers), with attached feedback rows.
 */

import "server-only";

import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  listMessagesForConversation,
  listRecentConversations,
} from "@/lib/baxter-ai/conversations";
import { pickSlackDisplayName, slackUserFallbackLabel } from "@/lib/slack/display-names";
import { resolveBaxterUserForSlackIdentity } from "@/lib/slack/identity";
import type { BaxterFeedbackChannel, BaxterFeedbackRating } from "./feedback-types";
import {
  inDateRange,
  type DateRangeBounds,
  type FeedbackSortDirection,
} from "./feedback-date-ranges";
import type { BaxterMessageFeedback } from "./feedback";

export type InquirySummarizedRating = "positive" | "negative" | "none";

export type BaxterInquiryFeedbackEntry = {
  id: string;
  rating: BaxterFeedbackRating;
  comment: string | null;
  createdAt: string;
  commenterLabel: string;
};

export type BaxterInquiryAdminRow = {
  messageId: string;
  conversationId: string;
  createdAt: string;
  channel: BaxterFeedbackChannel;
  summarizedRating: InquirySummarizedRating;
  /** Truncated preview for the collapsed row (same length as before). */
  questionExcerpt: string;
  answerExcerpt: string;
  /** Full question/answer for client-side "See more" expand. */
  questionText: string;
  answerText: string;
  askerKey: string;
  askerLabel: string;
  /** Null means Unassigned. */
  department: string | null;
  feedbackEntries: BaxterInquiryFeedbackEntry[];
  answerMode: string | null;
  sourceCount: number;
  errorCode: string | null;
};

export type FeedbackAskerOption = {
  key: string;
  label: string;
  channel: BaxterFeedbackChannel | "unknown";
};

export type InquiryListFilters = {
  rating?: "all" | InquirySummarizedRating;
  channel?: "all" | BaxterFeedbackChannel;
  /**
   * Multi-select asker keys (OR). Empty / omitted = no asker filter.
   * `askerKey` is accepted as a single-value alias for back-compat.
   */
  askerKeys?: string[] | null;
  askerKey?: string | null;
  /**
   * Multi-select departments (OR, case-insensitive). Empty / omitted = no dept filter.
   * `department` is accepted as a single-value alias for back-compat.
   */
  departments?: string[] | null;
  department?: string | null;
  range?: DateRangeBounds | null;
  sort?: FeedbackSortDirection;
  limit?: number;
  offset?: number;
};

/** Normalize single + multi asker inputs into a deduped list of non-empty keys. */
export function normalizeAskerKeysFilter(input: {
  askerKeys?: string[] | null;
  askerKey?: string | null;
}): string[] {
  const fromMulti = (input.askerKeys ?? []).map((k) => k.trim()).filter(Boolean);
  const fromSingle = input.askerKey?.trim();
  const set = new Set<string>(fromMulti);
  if (fromSingle) set.add(fromSingle);
  return Array.from(set);
}

/** Normalize single + multi department inputs into a deduped list. */
export function normalizeDepartmentsFilter(input: {
  departments?: string[] | null;
  department?: string | null;
}): string[] {
  const fromMulti = (input.departments ?? []).map((d) => d.trim()).filter(Boolean);
  const fromSingle = input.department?.trim();
  const set = new Set<string>(fromMulti);
  if (fromSingle) set.add(fromSingle);
  return Array.from(set);
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

export function summarizeInquiryRating(
  entries: Array<{ rating: BaxterFeedbackRating }>,
): InquirySummarizedRating {
  if (entries.some((e) => e.rating === "down")) return "negative";
  if (entries.some((e) => e.rating === "up")) return "positive";
  return "none";
}

export function encodeWebAskerKey(userId: string): string {
  return `web:${userId}`;
}

export function encodeSlackAskerKey(teamId: string | null, slackUserId: string): string {
  return `slack:${teamId ?? "unknown"}:${slackUserId}`;
}

type RawInquiry = {
  messageId: string;
  conversationId: string;
  createdAt: string;
  content: string;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  channel: BaxterFeedbackChannel;
  userId: string | null;
  externalUserId: string | null;
  userDisplayName: string | null;
  /** Slack team inferred from external_thread_id when possible. */
  slackTeamId: string | null;
};

function teamFromExternalThread(externalThreadId: string | null): string | null {
  if (!externalThreadId) return null;
  // Format used by Baxter: `${team}:${channel}:...`
  const team = externalThreadId.split(":")[0];
  return team && team.startsWith("T") ? team : null;
}

async function loadRawInquiries(input: {
  range: DateRangeBounds;
  channel: "all" | BaxterFeedbackChannel;
}): Promise<RawInquiry[]> {
  const out: RawInquiry[] = [];

  if (shouldUseMemory()) {
    const convs = await listRecentConversations(10_000);
    const mem = (
      globalThis as typeof globalThis & {
        __baxterConversationMemory?: { messages: Map<string, import("./types").BaxterMessage[]> };
      }
    ).__baxterConversationMemory;
    for (const conv of convs) {
      if (input.channel !== "all" && conv.channel !== input.channel) continue;
      // Prefer in-memory map — avoids N× listMessagesForConversation in tests/mock mode.
      const messages = mem?.messages.get(conv.id) ?? (await listMessagesForConversation(conv.id));
      for (const m of messages) {
        if (m.role !== "assistant") continue;
        if (!inDateRange(m.created_at, input.range)) continue;
        out.push({
          messageId: m.id,
          conversationId: conv.id,
          createdAt: m.created_at,
          content: m.content,
          errorCode: m.error_code,
          metadata: m.metadata ?? {},
          channel: conv.channel,
          userId: conv.user_id,
          externalUserId: conv.external_user_id,
          userDisplayName: conv.user_display_name,
          slackTeamId: teamFromExternalThread(conv.external_thread_id),
        });
      }
    }
    return out;
  }

  const supabase = createServiceClient();
  let query = supabase
    .from("baxter_messages")
    .select(
      "id, conversation_id, content, created_at, error_code, metadata, baxter_conversations!inner(id, channel, user_id, external_user_id, user_display_name, external_thread_id)",
    )
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (input.range.start) query = query.gte("created_at", input.range.start);
  if (input.range.end) query = query.lte("created_at", input.range.end);
  if (input.channel !== "all") {
    query = query.eq("baxter_conversations.channel", input.channel);
  }

  const { data, error } = await query;
  if (error) throw error;

  for (const row of data ?? []) {
    const conv = row.baxter_conversations as {
      id?: string;
      channel?: string;
      user_id?: string | null;
      external_user_id?: string | null;
      user_display_name?: string | null;
      external_thread_id?: string | null;
    } | null;
    if (!conv || (conv.channel !== "web" && conv.channel !== "slack")) continue;
    out.push({
      messageId: String(row.id),
      conversationId: String(row.conversation_id),
      createdAt: String(row.created_at),
      content: String(row.content ?? ""),
      errorCode: (row.error_code as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      channel: conv.channel,
      userId: conv.user_id ?? null,
      externalUserId: conv.external_user_id ?? null,
      userDisplayName: conv.user_display_name ?? null,
      slackTeamId: teamFromExternalThread(conv.external_thread_id ?? null),
    });
  }
  return out;
}

async function loadFeedbackByMessageIds(
  messageIds: string[],
): Promise<Map<string, BaxterMessageFeedback[]>> {
  const map = new Map<string, BaxterMessageFeedback[]>();
  if (messageIds.length === 0) return map;

  if (shouldUseMemory()) {
    const { getFeedbackMemoryRowsForTests } = await import("./feedback");
    for (const row of getFeedbackMemoryRowsForTests()) {
      if (!messageIds.includes(row.message_id)) continue;
      const list = map.get(row.message_id) ?? [];
      list.push(row);
      map.set(row.message_id, list);
    }
    return map;
  }

  const supabase = createServiceClient();
  // Chunk to avoid URL limits
  for (let i = 0; i < messageIds.length; i += 200) {
    const chunk = messageIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("baxter_message_feedback")
      .select("*")
      .in("message_id", chunk);
    if (error) throw error;
    for (const raw of data ?? []) {
      const row = {
        id: String(raw.id),
        message_id: String(raw.message_id),
        conversation_id: String(raw.conversation_id),
        user_id: (raw.user_id as string | null) ?? null,
        slack_user_id: (raw.slack_user_id as string | null) ?? null,
        slack_team_id: (raw.slack_team_id as string | null) ?? null,
        rating: raw.rating as BaxterFeedbackRating,
        comment: (raw.comment as string | null) ?? null,
        created_at: String(raw.created_at),
        updated_at: String(raw.updated_at),
      };
      const list = map.get(row.message_id) ?? [];
      list.push(row);
      map.set(row.message_id, list);
    }
  }
  return map;
}

type ProfileDept = {
  id: string;
  full_name: string;
  department: string | null;
  email?: string | null;
};

async function loadProfileMap(userIds: string[]): Promise<Map<string, ProfileDept>> {
  const map = new Map<string, ProfileDept>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return map;

  if (shouldUseMemory()) {
    const { getReportStore } = await import("@/lib/research/report-store");
    const profiles = await getReportStore().listProfiles();
    for (const p of profiles) {
      if (!unique.includes(p.id)) continue;
      map.set(p.id, {
        id: p.id,
        full_name: p.full_name,
        department: p.department?.trim() || p.department_name?.trim() || null,
      });
    }
    return map;
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, department, department_id, departments(name)")
    .in("id", unique);
  for (const row of data ?? []) {
    const depts = row.departments as { name?: string } | null;
    const dept = (row.department as string | null)?.trim() || depts?.name?.trim() || null;
    map.set(String(row.id), {
      id: String(row.id),
      full_name: String(row.full_name ?? ""),
      department: dept,
    });
  }
  return map;
}

async function loadSlackProfileLabel(
  teamId: string,
  slackUserId: string,
): Promise<{ label: string; email: string | null }> {
  if (shouldUseMemory()) {
    const { getCachedSlackUserProfile } = await import("@/lib/slack/profiles");
    const cached = await getCachedSlackUserProfile(teamId, slackUserId);
    if (!cached) return { label: slackUserFallbackLabel(slackUserId), email: null };
    return {
      label: pickSlackDisplayName(cached),
      email: cached.email?.trim().toLowerCase() || null,
    };
  }
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("slack_user_profiles")
    .select("display_name, real_name, username, email, slack_user_id")
    .eq("team_id", teamId)
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  if (!data) return { label: slackUserFallbackLabel(slackUserId), email: null };
  return {
    label: pickSlackDisplayName(data),
    email: (data.email as string | null)?.trim().toLowerCase() || null,
  };
}

async function resolveDepartmentForEmail(email: string): Promise<string | null> {
  if (shouldUseMemory()) return null;
  try {
    const supabase = createServiceClient();
    const admin = supabase.auth.admin as unknown as {
      getUserByEmail?: (email: string) => Promise<{
        data: { user: { id: string } | null };
        error: unknown;
      }>;
    };
    if (!admin.getUserByEmail) return null;
    const { data, error } = await admin.getUserByEmail(email);
    if (error || !data.user?.id) return null;
    const profiles = await loadProfileMap([data.user.id]);
    return profiles.get(data.user.id)?.department ?? null;
  } catch {
    return null;
  }
}

async function loadSlackProfilesBatch(
  pairs: Array<{ teamId: string; slackUserId: string }>,
): Promise<Map<string, { label: string; email: string | null }>> {
  const map = new Map<string, { label: string; email: string | null }>();
  const unique = new Map<string, { teamId: string; slackUserId: string }>();
  for (const p of pairs) {
    if (!p.teamId || !p.slackUserId || p.teamId === "unknown") continue;
    unique.set(`${p.teamId}:${p.slackUserId}`, p);
  }
  if (unique.size === 0) return map;

  if (shouldUseMemory()) {
    await Promise.all(
      [...unique.values()].map(async ({ teamId, slackUserId }) => {
        const info = await loadSlackProfileLabel(teamId, slackUserId);
        map.set(`${teamId}:${slackUserId}`, info);
      }),
    );
    return map;
  }

  const byTeam = new Map<string, string[]>();
  for (const { teamId, slackUserId } of unique.values()) {
    const list = byTeam.get(teamId) ?? [];
    list.push(slackUserId);
    byTeam.set(teamId, list);
  }

  const supabase = createServiceClient();
  await Promise.all(
    [...byTeam.entries()].map(async ([teamId, userIds]) => {
      const deduped = [...new Set(userIds)];
      for (let i = 0; i < deduped.length; i += 200) {
        const chunk = deduped.slice(i, i + 200);
        const { data } = await supabase
          .from("slack_user_profiles")
          .select("display_name, real_name, username, email, slack_user_id, team_id")
          .eq("team_id", teamId)
          .in("slack_user_id", chunk);
        for (const row of data ?? []) {
          const sid = String(row.slack_user_id);
          map.set(`${teamId}:${sid}`, {
            label: pickSlackDisplayName(row),
            email: (row.email as string | null)?.trim().toLowerCase() || null,
          });
        }
      }
      for (const sid of deduped) {
        const key = `${teamId}:${sid}`;
        if (!map.has(key)) {
          map.set(key, { label: slackUserFallbackLabel(sid), email: null });
        }
      }
    }),
  );
  return map;
}

/**
 * Batch-load user messages for many conversations (one/few queries), then pick
 * the latest user message at-or-before each assistant timestamp.
 */
async function loadPriorUserQuestions(
  items: Array<{ conversationId: string; createdAt: string; messageId: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;

  const convIds = [...new Set(items.map((i) => i.conversationId))];
  const messagesByConv = new Map<
    string,
    Array<{ role: string; content: string; created_at: string }>
  >();

  if (shouldUseMemory()) {
    const mem = (
      globalThis as typeof globalThis & {
        __baxterConversationMemory?: {
          messages: Map<string, Array<{ role: string; content: string; created_at: string }>>;
        };
      }
    ).__baxterConversationMemory;
    for (const id of convIds) {
      const messages = mem?.messages.get(id) ?? (await listMessagesForConversation(id));
      messagesByConv.set(id, messages);
    }
  } else {
    const supabase = createServiceClient();
    for (let i = 0; i < convIds.length; i += 100) {
      const chunk = convIds.slice(i, i + 100);
      const { data, error } = await supabase
        .from("baxter_messages")
        .select("conversation_id, role, content, created_at")
        .in("conversation_id", chunk)
        .eq("role", "user")
        .order("created_at", { ascending: true });
      if (error) throw error;
      for (const row of data ?? []) {
        const cid = String(row.conversation_id);
        const list = messagesByConv.get(cid) ?? [];
        list.push({
          role: String(row.role),
          content: String(row.content ?? ""),
          created_at: String(row.created_at),
        });
        messagesByConv.set(cid, list);
      }
    }
  }

  for (const item of items) {
    const messages = messagesByConv.get(item.conversationId) ?? [];
    const userMsg = [...messages]
      .reverse()
      .find((m) => m.role === "user" && m.created_at <= item.createdAt);
    out.set(item.messageId, userMsg?.content ?? "");
  }
  return out;
}

async function resolveSlackAskerInfoBatch(
  keys: Array<{ teamId: string; slackUserId: string }>,
): Promise<Map<string, { label: string; email: string | null; department: string | null }>> {
  const result = new Map<
    string,
    { label: string; email: string | null; department: string | null }
  >();
  const unique = new Map<string, { teamId: string; slackUserId: string }>();
  for (const k of keys) {
    if (!k.slackUserId) continue;
    const teamId = k.teamId || "unknown";
    unique.set(`${teamId}:${k.slackUserId}`, { teamId, slackUserId: k.slackUserId });
  }
  if (unique.size === 0) return result;

  const labels = await loadSlackProfilesBatch([...unique.values()]);

  const identityEntries = await Promise.all(
    [...unique.values()].map(async ({ teamId, slackUserId }) => {
      const cacheKey = `${teamId}:${slackUserId}`;
      const labelEmail = labels.get(cacheKey) ?? {
        label: slackUserFallbackLabel(slackUserId),
        email: null,
      };
      let department: string | null = null;
      let label = labelEmail.label;
      if (!shouldUseMemory() && teamId !== "unknown") {
        const matched = await resolveBaxterUserForSlackIdentity({
          slackUserId,
          slackTeamId: teamId,
        }).catch(() => null);
        if (matched?.userId) {
          const profiles = await loadProfileMap([matched.userId]);
          department = profiles.get(matched.userId)?.department ?? null;
          if (matched.displayName) label = matched.displayName;
        }
      }
      return {
        cacheKey,
        label,
        email: labelEmail.email,
        department,
      };
    }),
  );

  const emailsNeedingDept = identityEntries
    .filter((e) => !e.department && e.email)
    .map((e) => e.email!);
  const deptByEmail = new Map<string, string | null>();
  await Promise.all(
    [...new Set(emailsNeedingDept)].map(async (email) => {
      deptByEmail.set(email, await resolveDepartmentForEmail(email));
    }),
  );

  for (const entry of identityEntries) {
    const department =
      entry.department ?? (entry.email ? (deptByEmail.get(entry.email) ?? null) : null);
    result.set(entry.cacheKey, {
      label: entry.label,
      email: entry.email,
      department,
    });
  }
  return result;
}

/**
 * Identity + feedback enrichment without per-row conversation message fetches.
 * Question text is attached later only for the visible page.
 */
async function enrichInquiryIdentities(raw: RawInquiry[]): Promise<BaxterInquiryAdminRow[]> {
  const feedbackMap = await loadFeedbackByMessageIds(raw.map((r) => r.messageId));

  const webUserIds = [
    ...raw.map((r) => r.userId).filter((id): id is string => Boolean(id)),
    ...[...feedbackMap.values()].flatMap((list) =>
      list.map((f) => f.user_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const profileMap = await loadProfileMap(webUserIds);

  const slackKeys: Array<{ teamId: string; slackUserId: string }> = [];
  for (const item of raw) {
    if (item.channel === "slack" && item.externalUserId) {
      slackKeys.push({
        teamId: item.slackTeamId ?? "unknown",
        slackUserId: item.externalUserId,
      });
    }
  }
  for (const list of feedbackMap.values()) {
    for (const fb of list) {
      if (fb.slack_user_id) {
        slackKeys.push({
          teamId: fb.slack_team_id ?? "unknown",
          slackUserId: fb.slack_user_id,
        });
      }
    }
  }
  const slackAskerMap = await resolveSlackAskerInfoBatch(slackKeys);

  return raw.map((item) => {
    const feedback = feedbackMap.get(item.messageId) ?? [];
    const summarizedRating = summarizeInquiryRating(feedback);

    let askerKey = "unknown";
    let askerLabel = item.userDisplayName?.trim() || "Unknown";
    let department: string | null = null;

    if (item.channel === "web" && item.userId) {
      askerKey = encodeWebAskerKey(item.userId);
      const profile = profileMap.get(item.userId);
      askerLabel = profile?.full_name?.trim() || item.userDisplayName?.trim() || "Web user";
      department = profile?.department ?? null;
    } else if (item.channel === "slack" && item.externalUserId) {
      const teamId = item.slackTeamId ?? "unknown";
      askerKey = encodeSlackAskerKey(teamId, item.externalUserId);
      const slackInfo = slackAskerMap.get(`${teamId}:${item.externalUserId}`);
      askerLabel = slackInfo?.label ?? slackUserFallbackLabel(item.externalUserId);
      department = slackInfo?.department ?? null;
    }

    const feedbackEntries: BaxterInquiryFeedbackEntry[] = feedback.map((fb) => {
      let commenterLabel = "Unknown";
      if (fb.user_id) {
        commenterLabel = profileMap.get(fb.user_id)?.full_name?.trim() || "Web user";
      } else if (fb.slack_user_id) {
        const team = fb.slack_team_id ?? item.slackTeamId ?? "unknown";
        commenterLabel =
          slackAskerMap.get(`${team}:${fb.slack_user_id}`)?.label ??
          slackUserFallbackLabel(fb.slack_user_id);
      }
      return {
        id: fb.id,
        rating: fb.rating,
        comment: fb.comment,
        createdAt: fb.created_at,
        commenterLabel,
      };
    });

    const meta = item.metadata as {
      sources?: unknown[];
      answerMode?: string;
    };
    const answerText = item.content;

    return {
      messageId: item.messageId,
      conversationId: item.conversationId,
      createdAt: item.createdAt,
      channel: item.channel,
      summarizedRating,
      questionExcerpt: "",
      answerExcerpt: answerText.slice(0, 240),
      questionText: "",
      answerText,
      askerKey,
      askerLabel,
      department,
      feedbackEntries,
      answerMode: meta.answerMode ?? null,
      sourceCount: Array.isArray(meta.sources) ? meta.sources.length : 0,
      errorCode: item.errorCode,
    };
  });
}

async function attachQuestionsToInquiryRows(
  rows: BaxterInquiryAdminRow[],
): Promise<BaxterInquiryAdminRow[]> {
  if (rows.length === 0) return rows;
  const questions = await loadPriorUserQuestions(
    rows.map((r) => ({
      conversationId: r.conversationId,
      createdAt: r.createdAt,
      messageId: r.messageId,
    })),
  );
  return rows.map((row) => {
    const questionText = questions.get(row.messageId) ?? "";
    return {
      ...row,
      questionText,
      questionExcerpt: questionText.slice(0, 200),
    };
  });
}

export async function listInquiriesForAdmin(input?: InquiryListFilters): Promise<{
  rows: BaxterInquiryAdminRow[];
  totalMatching: number;
  positiveCount: number;
  negativeCount: number;
  noFeedbackCount: number;
  totalInquiries: number;
  channelBreakdown: { web: number; slack: number };
}> {
  const started = Date.now();
  const range: DateRangeBounds = input?.range ?? { start: null, end: null };
  const channel = input?.channel ?? "all";
  const rating = input?.rating ?? "all";
  const sort = input?.sort ?? "newest";
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 100);
  const offset = Math.max(input?.offset ?? 0, 0);
  const askerKeys = normalizeAskerKeysFilter({
    askerKeys: input?.askerKeys,
    askerKey: input?.askerKey,
  });
  const departments = normalizeDepartmentsFilter({
    departments: input?.departments,
    department: input?.department,
  });
  const departmentSet = new Set(departments.map((d) => d.toLowerCase()));

  const tRaw = Date.now();
  const raw = await loadRawInquiries({ range, channel });
  const rawMs = Date.now() - tRaw;

  const tIdentity = Date.now();
  let enriched = await enrichInquiryIdentities(raw);
  const identityMs = Date.now() - tIdentity;

  if (askerKeys.length > 0) {
    const askerSet = new Set(askerKeys);
    enriched = enriched.filter((r) => askerSet.has(r.askerKey));
  }
  if (departments.length > 0) {
    // Selected departments exclude Unassigned (null); match is case-insensitive OR.
    enriched = enriched.filter(
      (r) => r.department != null && departmentSet.has(r.department.toLowerCase()),
    );
  }

  // Counts are inquiry-based over range/channel/asker/department.
  // Rating filter only affects the list; summary always shows the three-way split.
  const positiveCount = enriched.filter((r) => r.summarizedRating === "positive").length;
  const negativeCount = enriched.filter((r) => r.summarizedRating === "negative").length;
  const noFeedbackCount = enriched.filter((r) => r.summarizedRating === "none").length;
  const totalInquiries = enriched.length;
  const channelBreakdown = {
    web: enriched.filter((r) => r.channel === "web").length,
    slack: enriched.filter((r) => r.channel === "slack").length,
  };

  const afterRating =
    rating === "all" ? enriched : enriched.filter((r) => r.summarizedRating === rating);

  const sorted = [...afterRating].sort((a, b) =>
    sort === "oldest"
      ? a.createdAt.localeCompare(b.createdAt)
      : b.createdAt.localeCompare(a.createdAt),
  );
  const pageIdentity = sorted.slice(offset, offset + limit);

  const tQuestions = Date.now();
  const page = await attachQuestionsToInquiryRows(pageIdentity);
  const questionsMs = Date.now() - tQuestions;

  console.info(
    "[feedback-inquiries] listInquiriesForAdmin",
    JSON.stringify({
      rawCount: raw.length,
      pageSize: page.length,
      rawMs,
      identityMs,
      questionsMs,
      totalMs: Date.now() - started,
    }),
  );

  return {
    rows: page,
    totalMatching: afterRating.length,
    positiveCount,
    negativeCount,
    noFeedbackCount,
    totalInquiries,
    channelBreakdown,
  };
}

export async function listFeedbackAskerOptions(): Promise<FeedbackAskerOption[]> {
  const started = Date.now();
  const raw = await loadRawInquiries({
    range: { start: null, end: null },
    channel: "all",
  });
  // Identity only — asker dropdown does not need question text (avoids N message fetches).
  const enriched = await enrichInquiryIdentities(raw);
  const map = new Map<string, FeedbackAskerOption>();
  for (const row of enriched) {
    if (row.askerKey === "unknown") continue;
    if (!map.has(row.askerKey)) {
      map.set(row.askerKey, {
        key: row.askerKey,
        label: row.askerLabel,
        channel: row.channel,
      });
    }
  }
  console.info(
    "[feedback-inquiries] listFeedbackAskerOptions",
    JSON.stringify({ rawCount: raw.length, options: map.size, totalMs: Date.now() - started }),
  );
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function listFeedbackDepartmentOptions(): Promise<string[]> {
  const { listDistinctDepartmentLabels } = await import("@/lib/org/departments");
  return listDistinctDepartmentLabels();
}
