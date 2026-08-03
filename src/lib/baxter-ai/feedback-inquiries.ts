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
  questionExcerpt: string;
  answerExcerpt: string;
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
  askerKey?: string | null;
  department?: string | null;
  range?: DateRangeBounds | null;
  sort?: FeedbackSortDirection;
  limit?: number;
  offset?: number;
};

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
    for (const conv of convs) {
      if (input.channel !== "all" && conv.channel !== input.channel) continue;
      const messages = await listMessagesForConversation(conv.id);
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

async function enrichInquiries(raw: RawInquiry[]): Promise<BaxterInquiryAdminRow[]> {
  const feedbackMap = await loadFeedbackByMessageIds(raw.map((r) => r.messageId));
  const webUserIds = raw.map((r) => r.userId).filter((id): id is string => Boolean(id));
  const profileMap = await loadProfileMap(webUserIds);

  // Preload slack labels
  const slackCache = new Map<
    string,
    { label: string; email: string | null; department: string | null }
  >();

  const rows: BaxterInquiryAdminRow[] = [];
  for (const item of raw) {
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
      const cacheKey = `${teamId}:${item.externalUserId}`;
      let slackInfo = slackCache.get(cacheKey);
      if (!slackInfo) {
        const labelEmail = await loadSlackProfileLabel(teamId, item.externalUserId);
        let dept: string | null = null;
        // Prefer identity resolution → profile department (skip network in memory/tests)
        if (!shouldUseMemory() && teamId !== "unknown") {
          const matched = await resolveBaxterUserForSlackIdentity({
            slackUserId: item.externalUserId,
            slackTeamId: teamId,
          }).catch(() => null);
          if (matched?.userId) {
            const profiles = await loadProfileMap([matched.userId]);
            dept = profiles.get(matched.userId)?.department ?? null;
            if (matched.displayName) labelEmail.label = matched.displayName;
          }
        }
        if (!dept && labelEmail.email) {
          dept = await resolveDepartmentForEmail(labelEmail.email);
        }
        slackInfo = {
          label: labelEmail.label,
          email: labelEmail.email,
          department: dept,
        };
        slackCache.set(cacheKey, slackInfo);
      }
      askerLabel = slackInfo.label;
      department = slackInfo.department;
    }

    const feedbackEntries: BaxterInquiryFeedbackEntry[] = [];
    for (const fb of feedback) {
      let commenterLabel = "Unknown";
      if (fb.user_id) {
        const p =
          profileMap.get(fb.user_id) ?? (await loadProfileMap([fb.user_id])).get(fb.user_id);
        commenterLabel = p?.full_name?.trim() || "Web user";
      } else if (fb.slack_user_id) {
        const team = fb.slack_team_id ?? item.slackTeamId ?? "unknown";
        const info = await loadSlackProfileLabel(team, fb.slack_user_id);
        commenterLabel = info.label;
      }
      feedbackEntries.push({
        id: fb.id,
        rating: fb.rating,
        comment: fb.comment,
        createdAt: fb.created_at,
        commenterLabel,
      });
    }

    // Question excerpt: prior user message
    let questionExcerpt = "";
    try {
      const messages = await listMessagesForConversation(item.conversationId);
      const userMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user" && m.created_at <= item.createdAt);
      questionExcerpt = (userMsg?.content ?? "").slice(0, 200);
    } catch {
      // ignore
    }

    const meta = item.metadata as {
      sources?: unknown[];
      answerMode?: string;
    };

    rows.push({
      messageId: item.messageId,
      conversationId: item.conversationId,
      createdAt: item.createdAt,
      channel: item.channel,
      summarizedRating,
      questionExcerpt,
      answerExcerpt: item.content.slice(0, 240),
      askerKey,
      askerLabel,
      department,
      feedbackEntries,
      answerMode: meta.answerMode ?? null,
      sourceCount: Array.isArray(meta.sources) ? meta.sources.length : 0,
      errorCode: item.errorCode,
    });
  }
  return rows;
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
  const range: DateRangeBounds = input?.range ?? { start: null, end: null };
  const channel = input?.channel ?? "all";
  const rating = input?.rating ?? "all";
  const sort = input?.sort ?? "newest";
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 100);
  const offset = Math.max(input?.offset ?? 0, 0);
  const askerKey = input?.askerKey?.trim() || null;
  const departmentFilter = input?.department?.trim() || null;

  const raw = await loadRawInquiries({ range, channel });
  let enriched = await enrichInquiries(raw);

  if (askerKey) {
    enriched = enriched.filter((r) => r.askerKey === askerKey);
  }
  if (departmentFilter) {
    // Specific department excludes Unassigned (null)
    enriched = enriched.filter(
      (r) => r.department != null && r.department.toLowerCase() === departmentFilter.toLowerCase(),
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
  const page = sorted.slice(offset, offset + limit);

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
  const raw = await loadRawInquiries({
    range: { start: null, end: null },
    channel: "all",
  });
  // Deduplicate by asker key using enrichment (lighter path)
  const enriched = await enrichInquiries(raw);
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
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function listFeedbackDepartmentOptions(): Promise<string[]> {
  const { listDistinctDepartmentLabels } = await import("@/lib/org/departments");
  return listDistinctDepartmentLabels();
}
