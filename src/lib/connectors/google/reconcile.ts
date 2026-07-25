import "server-only";

import { listGoogleSyncFolders } from "./folders";
import { listSelectionsForRoot } from "./selections";
import { listSyncedFilesForRoot, upsertSyncedFile } from "./synced-files";
import {
  listAllKnowledgeEntriesForRetrieval,
  setKnowledgeEntryStatus,
} from "@/lib/knowledge/store";
import { GoogleWorkspaceConnector } from "./sync";

export type ReconcileIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  googleFileId?: string;
  knowledgeEntryId?: string;
  selectionId?: string;
  actionTaken?: string;
};

export type ReconcileResult = {
  issues: ReconcileIssue[];
  repaired: number;
  failed: number;
};

/**
 * Ensure Google selections, synced files, and Knowledge entries stay consistent.
 * An enabled file selection must end as: active entry | syncing/failed state | repaired.
 */
export async function reconcileGoogleKnowledgeState(options?: {
  rootId?: string | null;
  repair?: boolean;
  userId?: string | null;
}): Promise<ReconcileResult> {
  const repair = options?.repair !== false;
  const issues: ReconcileIssue[] = [];
  let repaired = 0;
  let failed = 0;

  const roots = await listGoogleSyncFolders();
  const scoped = options?.rootId ? roots.filter((r) => r.id === options.rootId) : roots;
  const entries = await listAllKnowledgeEntriesForRetrieval();
  const googleEntries = entries.filter((e) => e.source_type === "Google Drive");

  const needsSyncRoots = new Set<string>();

  for (const root of scoped) {
    const selections = (await listSelectionsForRoot(root.id)).filter(
      (s) => s.enabled && !s.explicitly_excluded && s.selection_type === "file",
    );
    const synced = await listSyncedFilesForRoot(root.id);

    for (const selection of selections) {
      const syncRow = synced.find((s) => s.google_file_id === selection.google_file_id);
      const entry = googleEntries.find(
        (e) => e.source_external_id === selection.google_file_id && e.status !== "archived",
      );

      if (!syncRow) {
        issues.push({
          code: "SELECTED_WITHOUT_SYNCED_FILE",
          severity: "warning",
          message: `Selected file “${selection.title_snapshot || selection.google_file_id}” has no sync record.`,
          googleFileId: selection.google_file_id,
          selectionId: selection.id,
        });
        needsSyncRoots.add(root.id);
        continue;
      }

      if (
        !entry &&
        syncRow.sync_status !== "failed" &&
        syncRow.sync_status !== "unsupported" &&
        syncRow.sync_status !== "queued" &&
        syncRow.sync_status !== "syncing"
      ) {
        issues.push({
          code: "SELECTED_WITHOUT_KNOWLEDGE_ENTRY",
          severity: "error",
          message: `Selected file “${selection.title_snapshot || selection.google_file_id}” has no Knowledge entry.`,
          googleFileId: selection.google_file_id,
          selectionId: selection.id,
        });
        needsSyncRoots.add(root.id);
      }

      if (entry && syncRow.knowledge_entry_id && syncRow.knowledge_entry_id !== entry.id) {
        issues.push({
          code: "SYNC_KNOWLEDGE_MISMATCH",
          severity: "warning",
          message: "Synced file points at a different Knowledge entry than expected.",
          googleFileId: selection.google_file_id,
          knowledgeEntryId: entry.id,
        });
        if (repair) {
          await upsertSyncedFile({
            ...syncRow,
            knowledge_entry_id: entry.id,
          });
          repaired += 1;
          const last = issues.at(-1);
          if (last) last.actionTaken = "Relinked synced file to active entry";
        }
      }

      if (syncRow.sync_status === "failed") {
        issues.push({
          code: "SYNC_FAILED",
          severity: "error",
          message:
            syncRow.last_error_message_safe ||
            `Import failed for “${selection.title_snapshot || selection.google_file_id}”.`,
          googleFileId: selection.google_file_id,
          selectionId: selection.id,
        });
      }
    }

    // Active Google KB entries without enabled selection → archive
    for (const entry of googleEntries) {
      if (entry.status === "archived") continue;
      const fileId = entry.source_external_id;
      if (!fileId) continue;
      const hasSelection = (await listSelectionsForRoot(root.id)).some(
        (s) => s.google_file_id === fileId && s.enabled && !s.explicitly_excluded,
      );
      // Only consider entries linked via this root's synced files
      const linked = synced.some((s) => s.knowledge_entry_id === entry.id);
      if (linked && !hasSelection) {
        issues.push({
          code: "ENTRY_WITHOUT_SELECTION",
          severity: "warning",
          message: `Knowledge entry “${entry.title}” is active without a Google selection.`,
          knowledgeEntryId: entry.id,
          googleFileId: fileId,
        });
        if (repair && options?.userId) {
          await setKnowledgeEntryStatus(entry.id, "archived", options.userId);
          repaired += 1;
          const last = issues.at(-1);
          if (last) last.actionTaken = "Archived orphaned Google entry";
        }
      }
    }

    // Duplicate active entries for one Google file
    const byFile = new Map<string, typeof googleEntries>();
    for (const entry of googleEntries) {
      if (!entry.source_external_id || entry.status === "archived") continue;
      const list = byFile.get(entry.source_external_id) ?? [];
      list.push(entry);
      byFile.set(entry.source_external_id, list);
    }
    for (const [fileId, dups] of byFile) {
      if (dups.length < 2) continue;
      issues.push({
        code: "DUPLICATE_GOOGLE_ENTRIES",
        severity: "error",
        message: `Multiple active Knowledge entries for Google file ${fileId}.`,
        googleFileId: fileId,
      });
      if (repair && options?.userId) {
        const sorted = [...dups].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        for (const extra of sorted.slice(1)) {
          await setKnowledgeEntryStatus(extra.id, "archived", options.userId);
          repaired += 1;
        }
        const last = issues.at(-1);
        if (last) last.actionTaken = "Archived duplicate entries; kept newest";
      }
    }
  }

  if (repair && needsSyncRoots.size > 0) {
    for (const rootId of needsSyncRoots) {
      try {
        await new GoogleWorkspaceConnector().sync({
          folderId: rootId,
          triggerSource: "manual",
        });
        repaired += 1;
        issues.push({
          code: "RESYNC_TRIGGERED",
          severity: "info",
          message: "Triggered sync to repair missing Knowledge entries.",
          actionTaken: "Synced root",
        });
      } catch (error) {
        failed += 1;
        issues.push({
          code: "GOOGLE_RECONCILIATION_FAILED",
          severity: "error",
          message:
            error instanceof Error ? error.message.slice(0, 240) : "Reconciliation sync failed.",
        });
      }
    }
  }

  return { issues, repaired, failed };
}
