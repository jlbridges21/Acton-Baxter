import "server-only";

import { GoogleConnectorError } from "./errors";
import { listGoogleSyncFolders, updateGoogleSyncFolder } from "./folders";
import {
  listSelectionsForRoot,
  removeSelection,
  setSelectionEnabled,
  upsertSelection,
} from "./selections";
import { GoogleWorkspaceConnector } from "./sync";
import { listSyncedFilesForRoot, upsertSyncedFile } from "./synced-files";
import {
  listAllKnowledgeEntriesForRetrieval,
  setKnowledgeEntryStatus,
} from "@/lib/knowledge/store";

export type AddToBaxterFile = {
  googleFileId: string;
  selectionType: "file" | "folder";
  title?: string;
  mimeType?: string;
  driveId?: string | null;
  parentFileId?: string | null;
  recursive?: boolean;
  includeFutureFiles?: boolean;
};

/**
 * Save selections and immediately sync so Knowledge Center entries appear.
 */
export async function addFilesToBaxter(input: {
  rootId: string;
  userId: string;
  files: AddToBaxterFile[];
}): Promise<{
  selectionCount: number;
  sync: Awaited<ReturnType<GoogleWorkspaceConnector["sync"]>>;
  knowledgeEntryIds: string[];
}> {
  if (input.files.length === 0) {
    throw new GoogleConnectorError("Select at least one file to add to Baxter.", {
      code: "GOOGLE_FILE_SELECTION_FAILED",
      statusCode: 400,
      expose: true,
    });
  }

  const selections = [];
  for (const file of input.files) {
    const selection = await upsertSelection({
      rootId: input.rootId,
      googleFileId: file.googleFileId,
      selectionType: file.selectionType,
      recursive: file.recursive ?? true,
      includeFutureFiles: file.includeFutureFiles ?? true,
      explicitlyExcluded: false,
      enabled: true,
      titleSnapshot: file.title,
      mimeType: file.mimeType,
      driveId: file.driveId,
      parentFileId: file.parentFileId,
      userId: input.userId,
    });
    selections.push(selection);
  }

  const sync = await new GoogleWorkspaceConnector().sync({
    folderId: input.rootId,
    triggerSource: "manual",
  });

  const synced = await listSyncedFilesForRoot(input.rootId);
  const knowledgeEntryIds = synced
    .filter((row) =>
      input.files.some((f) => f.googleFileId === row.google_file_id && row.knowledge_entry_id),
    )
    .map((row) => row.knowledge_entry_id!)
    .filter(Boolean);

  return { selectionCount: selections.length, sync, knowledgeEntryIds };
}

/**
 * Remove Google file(s) from Baxter: disable selection, archive KB entry, mark synced removed.
 * Never touches the Google Drive file.
 */
export async function removeFilesFromBaxter(input: {
  rootId?: string | null;
  userId: string;
  googleFileIds?: string[];
  selectionIds?: string[];
  knowledgeEntryId?: string | null;
}): Promise<{ removed: number; archivedEntryIds: string[] }> {
  const roots = await listGoogleSyncFolders();
  const rootFilter = input.rootId ? roots.filter((r) => r.id === input.rootId) : roots;
  const archivedEntryIds: string[] = [];
  let removed = 0;

  const targetFileIds = new Set(input.googleFileIds ?? []);

  if (input.knowledgeEntryId) {
    const entries = await listAllKnowledgeEntriesForRetrieval();
    const entry = entries.find((e) => e.id === input.knowledgeEntryId);
    if (entry?.source_external_id) targetFileIds.add(entry.source_external_id);
  }

  for (const root of rootFilter) {
    const selections = await listSelectionsForRoot(root.id);
    for (const selection of selections) {
      const matchById = input.selectionIds?.includes(selection.id);
      const matchByFile = targetFileIds.has(selection.google_file_id);
      if (!matchById && !matchByFile) continue;

      if (selection.enabled) {
        await setSelectionEnabled(selection.id, false);
      }
      if (selection.explicitly_excluded) {
        await removeSelection(selection.id);
      }

      const synced = await listSyncedFilesForRoot(root.id);
      const row = synced.find((s) => s.google_file_id === selection.google_file_id);
      if (row) {
        await upsertSyncedFile({
          root_id: row.root_id,
          google_file_id: row.google_file_id,
          title: row.title,
          sync_status: "excluded",
          last_error_code: null,
          last_error_message_safe: "Removed from Baxter by administrator",
          metadata: { ...row.metadata, removedFromBaxterAt: new Date().toISOString() },
        });
        if (row.knowledge_entry_id) {
          try {
            await setKnowledgeEntryStatus(row.knowledge_entry_id, "archived", input.userId);
            archivedEntryIds.push(row.knowledge_entry_id);
          } catch {
            // entry may already be gone
          }
        }
      } else {
        const entries = await listAllKnowledgeEntriesForRetrieval();
        const entry = entries.find(
          (e) =>
            e.source_type === "Google Drive" &&
            e.source_external_id === selection.google_file_id &&
            e.status !== "archived",
        );
        if (entry) {
          await setKnowledgeEntryStatus(entry.id, "archived", input.userId);
          archivedEntryIds.push(entry.id);
        }
      }
      removed += 1;
    }
  }

  if (input.knowledgeEntryId && archivedEntryIds.length === 0) {
    try {
      await setKnowledgeEntryStatus(input.knowledgeEntryId, "archived", input.userId);
      archivedEntryIds.push(input.knowledgeEntryId);
      removed += 1;
    } catch {
      /* ignore */
    }
  }

  if (removed === 0 && !input.knowledgeEntryId) {
    throw new GoogleConnectorError("No matching Google selection was found to remove.", {
      code: "GOOGLE_FILE_DESELECTION_FAILED",
      statusCode: 404,
      expose: true,
    });
  }

  return { removed, archivedEntryIds };
}

export async function rememberBrowsedFolder(rootId: string, folderId: string): Promise<void> {
  await updateGoogleSyncFolder(rootId, {
    last_browsed_folder_id: folderId,
    last_browsed_at: new Date().toISOString(),
  });
}
