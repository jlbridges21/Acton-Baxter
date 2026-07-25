import "server-only";

import { listKnowledgeEntries } from "./queries";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import type { KnowledgeEntry } from "./types";

export type KnowledgeAnalytics = {
  totals: {
    total: number;
    approved: number;
    drafts: number;
    archived: number;
    manual: number;
    uploaded: number;
    google: number;
  };
  frequentlyCited: Array<{ id: string; title: string; citationCount: number }>;
  unusedApproved: Array<{ id: string; title: string; updatedAt: string }>;
  recentlyImported: Array<{ id: string; title: string; sourceType: string; updatedAt: string }>;
  unansweredHints: Array<{ question: string; createdAt: string }>;
};

function isGoogle(entry: KnowledgeEntry) {
  return (
    entry.source_type === "Google Drive" ||
    Boolean((entry.metadata as { googleManaged?: boolean } | undefined)?.googleManaged)
  );
}

function isUploaded(entry: KnowledgeEntry) {
  return entry.source_type === "uploaded_document";
}

function isManual(entry: KnowledgeEntry) {
  return !isGoogle(entry) && !isUploaded(entry);
}

export async function getKnowledgeAnalytics(): Promise<KnowledgeAnalytics> {
  const entries = await listKnowledgeEntries({ sort: "updated" }).catch(
    () => [] as KnowledgeEntry[],
  );

  const totals = {
    total: entries.length,
    approved: entries.filter((e) => e.status === "approved").length,
    drafts: entries.filter((e) => e.status === "draft").length,
    archived: entries.filter((e) => e.status === "archived").length,
    manual: entries.filter(isManual).length,
    uploaded: entries.filter(isUploaded).length,
    google: entries.filter(isGoogle).length,
  };

  const recentlyImported = entries
    .filter((e) => isUploaded(e) || isGoogle(e))
    .slice(0, 8)
    .map((e) => ({
      id: e.id,
      title: e.title,
      sourceType: isGoogle(e) ? "Google Workspace" : "Upload",
      updatedAt: e.updated_at,
    }));

  let frequentlyCited: KnowledgeAnalytics["frequentlyCited"] = [];
  let unusedApproved: KnowledgeAnalytics["unusedApproved"] = [];
  let unansweredHints: KnowledgeAnalytics["unansweredHints"] = [];

  try {
    const env = getEnv();
    const useMemory = Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
    if (!useMemory) {
      const supabase = createServiceClient();
      const { data: sourceRows } = await supabase
        .from("baxter_message_sources")
        .select("knowledge_entry_id");
      const counts = new Map<string, number>();
      for (const row of sourceRows ?? []) {
        const id = (row as { knowledge_entry_id?: string | null }).knowledge_entry_id;
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      frequentlyCited = [...counts.entries()]
        .map(([id, citationCount]) => {
          const entry = entries.find((e) => e.id === id);
          return entry
            ? { id, title: entry.title, citationCount }
            : { id, title: "Unknown entry", citationCount };
        })
        .sort((a, b) => b.citationCount - a.citationCount)
        .slice(0, 8);

      unusedApproved = entries
        .filter((e) => e.status === "approved" && !counts.has(e.id))
        .slice(0, 8)
        .map((e) => ({ id: e.id, title: e.title, updatedAt: e.updated_at }));

      const { data: unanswered } = await supabase
        .from("baxter_messages")
        .select("content, created_at, insufficient_knowledge, role")
        .eq("role", "assistant")
        .eq("insufficient_knowledge", true)
        .order("created_at", { ascending: false })
        .limit(8);

      unansweredHints = (unanswered ?? []).map((row) => ({
        question: String((row as { content?: string }).content ?? "").slice(0, 160),
        createdAt: String((row as { created_at?: string }).created_at ?? ""),
      }));
    } else {
      unusedApproved = entries
        .filter((e) => e.status === "approved")
        .slice(0, 8)
        .map((e) => ({ id: e.id, title: e.title, updatedAt: e.updated_at }));
    }
  } catch {
    unusedApproved = entries
      .filter((e) => e.status === "approved")
      .slice(0, 8)
      .map((e) => ({ id: e.id, title: e.title, updatedAt: e.updated_at }));
  }

  return {
    totals,
    frequentlyCited,
    unusedApproved,
    recentlyImported,
    unansweredHints,
  };
}
