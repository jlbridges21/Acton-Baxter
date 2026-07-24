import "server-only";

import {
  createKnowledgeEntry,
  listAllKnowledgeEntriesForRetrieval,
  patchKnowledgeEntrySyncFields,
  setKnowledgeEntryStatus,
  updateKnowledgeEntry,
} from "@/lib/knowledge/store";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import type { ConnectorHealth, ConnectorSyncResult, KnowledgeConnector } from "../types";
import { isGoogleWorkspaceConfigured } from "./auth";
import { getFolderMetadata, listFilesInFolder } from "./drive";
import { GoogleConfigError } from "./errors";
import { addGoogleSyncFolder, listGoogleSyncFolders, updateGoogleSyncFolder } from "./folders";
import { isSupportedGoogleMime, parseGoogleDriveFile } from "./parser";
import { GOOGLE_FOLDER_MIME } from "./types";

function nowIso() {
  return new Date().toISOString();
}

function findExistingByFileId(
  entries: KnowledgeEntry[],
  fileId: string,
): KnowledgeEntry | undefined {
  return entries.find(
    (entry) => entry.source_type === "Google Drive" && entry.source_external_id === fileId,
  );
}

function previousHash(entry: KnowledgeEntry): string {
  const google = entry.metadata?.google;
  if (!google || typeof google !== "object") return "";
  const hash = (google as { contentHash?: unknown }).contentHash;
  return typeof hash === "string" ? hash : "";
}

export class GoogleWorkspaceConnector implements KnowledgeConnector {
  readonly key = "google_workspace" as const;
  readonly name = "Google Workspace";

  async health(): Promise<ConnectorHealth> {
    const configured = isGoogleWorkspaceConfigured();
    const folders = await listGoogleSyncFolders();
    const active = folders.filter((folder) => folder.status === "active");
    const itemsSynced = folders.reduce((sum, folder) => sum + folder.indexed_document_count, 0);
    const lastSyncAt =
      folders
        .map((folder) => folder.last_sync_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    const lastError =
      folders
        .filter((folder) => folder.last_error)
        .map((folder) => folder.last_error)
        .at(-1) ?? null;

    if (!configured) {
      return {
        key: this.key,
        name: this.name,
        status: "offline",
        label: "Offline",
        lastSyncAt,
        lastError: "Service account credentials are not configured.",
        itemsSynced,
        details:
          "Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, then share Drive folders with the service account (baxter@actonadu.com or the SA email).",
      };
    }

    if (folders.some((folder) => folder.status === "error")) {
      return {
        key: this.key,
        name: this.name,
        status: "warning",
        label: "Warning",
        lastSyncAt,
        lastError,
        itemsSynced,
        details: `${active.length} active folder(s)`,
      };
    }

    if (active.length === 0) {
      return {
        key: this.key,
        name: this.name,
        status: "warning",
        label: "Warning",
        lastSyncAt,
        lastError: null,
        itemsSynced,
        details: "Configured, but no Drive folders are connected yet.",
      };
    }

    return {
      key: this.key,
      name: this.name,
      status: "healthy",
      label: "Healthy",
      lastSyncAt,
      lastError: null,
      itemsSynced,
      details: `${active.length} active folder(s)`,
    };
  }

  async listSources() {
    const folders = await listGoogleSyncFolders();
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.folder_name,
      status: folder.status,
    }));
  }

  async sync(options?: { folderId?: string }): Promise<ConnectorSyncResult> {
    if (!isGoogleWorkspaceConfigured()) {
      throw new GoogleConfigError();
    }

    const startedAt = nowIso();
    const result: ConnectorSyncResult = {
      connector: this.key,
      startedAt,
      finishedAt: startedAt,
      scanned: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
    };

    let folders = await listGoogleSyncFolders();
    if (options?.folderId) {
      folders = folders.filter(
        (folder) => folder.id === options.folderId || folder.folder_id === options.folderId,
      );
    }
    folders = folders.filter((folder) => folder.status === "active");

    const existingEntries = await listAllKnowledgeEntriesForRetrieval();

    for (const folder of folders) {
      try {
        await updateGoogleSyncFolder(folder.id, {
          last_sync_at: nowIso(),
          last_error: null,
        });

        const files = await listFilesInFolder(folder.folder_id);
        let indexed = 0;
        let latestModified: string | null = folder.last_modified_seen_at;

        for (const file of files) {
          if (file.mimeType === GOOGLE_FOLDER_MIME) {
            result.skipped += 1;
            continue;
          }
          result.scanned += 1;
          if (!isSupportedGoogleMime(file.mimeType)) {
            result.skipped += 1;
            continue;
          }

          try {
            const parsed = await parseGoogleDriveFile(file, folder.folder_id);
            if (!parsed.contentText || parsed.parseMode === "unsupported") {
              result.skipped += 1;
              continue;
            }

            const meta = {
              google: {
                fileId: parsed.fileId,
                mimeType: parsed.mimeType,
                revisionOrModified: parsed.modifiedTime,
                contentHash: parsed.contentHash,
                folderId: folder.folder_id,
                folderName: folder.folder_name,
                owner: parsed.owner,
                parseMode: parsed.parseMode,
                lastSyncedAt: nowIso(),
              },
            };

            const existing = findExistingByFileId(existingEntries, parsed.fileId);
            if (existing) {
              if (previousHash(existing) === parsed.contentHash) {
                result.unchanged += 1;
                indexed += 1;
                continue;
              }

              const updated = await updateKnowledgeEntry(
                existing.id,
                {
                  title: parsed.title,
                  content: parsed.contentText,
                  summary: `Synced from Google Workspace`,
                  category: "Google Workspace",
                  tags: ["google", parsed.mimeType.includes("spreadsheet") ? "sheet" : "doc"],
                  source_name: folder.folder_name,
                  source_type: "Google Drive",
                  source_url: parsed.webViewLink,
                  visibility: "internal",
                  change_note: "Google Workspace sync update",
                },
                existing.updated_by ?? existing.created_by ?? "google-sync",
              );

              if (updated.status === "draft") {
                await setKnowledgeEntryStatus(
                  updated.id,
                  "approved",
                  updated.updated_by ?? "google-sync",
                );
              }

              await patchKnowledgeEntrySyncFields(updated.id, {
                source_external_id: parsed.fileId,
                source_url: parsed.webViewLink,
                metadata: meta,
              });

              result.updated += 1;
              indexed += 1;
            } else {
              const created = await createKnowledgeEntry(
                {
                  title: parsed.title,
                  content: parsed.contentText,
                  summary: `Synced from Google Workspace`,
                  category: "Google Workspace",
                  tags: ["google", parsed.mimeType.includes("spreadsheet") ? "sheet" : "doc"],
                  source_name: folder.folder_name,
                  source_type: "Google Drive",
                  source_url: parsed.webViewLink,
                  visibility: "internal",
                  status: "approved",
                },
                folder.created_by ?? "google-sync",
              );
              const patched = await patchKnowledgeEntrySyncFields(created.id, {
                source_external_id: parsed.fileId,
                source_url: parsed.webViewLink,
                metadata: meta,
              });
              existingEntries.push(
                patched ?? { ...created, source_external_id: parsed.fileId, metadata: meta },
              );
              result.created += 1;
              indexed += 1;
            }

            if (parsed.modifiedTime && (!latestModified || parsed.modifiedTime > latestModified)) {
              latestModified = parsed.modifiedTime;
            }
          } catch (fileError) {
            result.errors.push(
              `${file.name}: ${fileError instanceof Error ? fileError.message : "sync failed"}`,
            );
          }
        }

        await updateGoogleSyncFolder(folder.id, {
          last_sync_at: nowIso(),
          last_success_at: nowIso(),
          last_error: result.errors.length ? result.errors.slice(-1)[0]! : null,
          indexed_document_count: indexed,
          last_modified_seen_at: latestModified,
          status: result.errors.length ? "error" : "active",
        });
      } catch (folderError) {
        const message = folderError instanceof Error ? folderError.message : "Folder sync failed";
        result.errors.push(`${folder.folder_name}: ${message}`);
        await updateGoogleSyncFolder(folder.id, {
          last_sync_at: nowIso(),
          last_error: message,
          status: "error",
        });
      }
    }

    result.finishedAt = nowIso();
    return result;
  }
}

export async function resolveAndAddFolder(input: { folderId: string; userId: string }) {
  if (!isGoogleWorkspaceConfigured()) throw new GoogleConfigError();
  const meta = await getFolderMetadata(input.folderId.trim());
  return addGoogleSyncFolder({
    folderId: meta.id,
    folderName: meta.name,
    driveId: meta.driveId ?? null,
    userId: input.userId,
  });
}
