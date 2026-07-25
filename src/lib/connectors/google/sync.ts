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
import { getDriveFile, getFolderMetadata, listFilesInFolder } from "./drive";
import { GoogleConfigError, GoogleConnectorError } from "./errors";
import { addGoogleSyncFolder, listGoogleSyncFolders, updateGoogleSyncFolder } from "./folders";
import { isSupportedGoogleMime, parseGoogleDriveFile } from "./parser";
import { GOOGLE_FOLDER_MIME, type GoogleDriveFile } from "./types";
import { normalizeGoogleFolderId } from "./folder-id";
import { listDescendantFiles } from "./browse";
import {
  listAllEnabledSelections,
  listSelectionsForRoot,
  type GoogleSourceSelection,
} from "./selections";
import { completeSyncRun, createSyncRun, upsertSyncedFile } from "./synced-files";

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

type ResolvedFile = {
  file: GoogleDriveFile;
  selection: GoogleSourceSelection | null;
  reason: string;
  rootId: string;
  rootFolderId: string;
  rootFolderName: string;
  category: string;
  tags: string[];
};

/**
 * Resolve files to sync from explicit selections.
 * Falls back to immediate children of active folders when no selections exist (legacy).
 */
export async function resolveFilesToSync(options?: { folderId?: string }): Promise<{
  files: ResolvedFile[];
  exclusions: Set<string>;
  roots: Awaited<ReturnType<typeof listGoogleSyncFolders>>;
}> {
  let folders = await listGoogleSyncFolders();
  if (options?.folderId) {
    folders = folders.filter(
      (folder) => folder.id === options.folderId || folder.folder_id === options.folderId,
    );
  }
  folders = folders.filter((folder) => folder.status === "active");

  const exclusions = new Set<string>();
  const resolved: ResolvedFile[] = [];
  const seen = new Set<string>();

  let anySelections = false;

  for (const folder of folders) {
    const selections = await listSelectionsForRoot(folder.id);
    const enabled = selections.filter((s) => s.enabled);
    const excludes = enabled.filter((s) => s.explicitly_excluded);
    const includes = enabled.filter((s) => !s.explicitly_excluded);

    for (const ex of excludes) exclusions.add(ex.google_file_id);

    if (includes.length === 0) continue;
    anySelections = true;

    for (const selection of includes) {
      if (selection.selection_type === "file") {
        if (exclusions.has(selection.google_file_id) || seen.has(selection.google_file_id)) {
          continue;
        }
        try {
          const file = await getDriveFile(selection.google_file_id);
          seen.add(file.id);
          resolved.push({
            file,
            selection,
            reason: "direct_file",
            rootId: folder.id,
            rootFolderId: folder.folder_id,
            rootFolderName: folder.folder_name,
            category: selection.default_category || "Google Workspace",
            tags: selection.default_tags.length
              ? selection.default_tags
              : ["google", file.mimeType.includes("spreadsheet") ? "sheet" : "doc"],
          });
        } catch {
          // access lost — recorded during sync
          resolved.push({
            file: {
              id: selection.google_file_id,
              name: selection.title_snapshot || selection.google_file_id,
              mimeType: selection.mime_type || "application/octet-stream",
            },
            selection,
            reason: "direct_file_access_lost",
            rootId: folder.id,
            rootFolderId: folder.folder_id,
            rootFolderName: folder.folder_name,
            category: selection.default_category || "Google Workspace",
            tags: selection.default_tags,
          });
        }
        continue;
      }

      // folder selection
      const descendants = await listDescendantFiles(selection.google_file_id, {
        recursive: selection.recursive,
        maxFiles: 500,
      });
      for (const file of descendants) {
        if (exclusions.has(file.id) || seen.has(file.id)) continue;
        // Future-file inclusion: always include discovered descendants for enabled folder selections
        if (!selection.include_future_files && selection.metadata?.lockedFileIds) {
          const locked = selection.metadata.lockedFileIds;
          if (Array.isArray(locked) && !locked.includes(file.id)) continue;
        }
        seen.add(file.id);
        resolved.push({
          file,
          selection,
          reason: "folder_descendant",
          rootId: folder.id,
          rootFolderId: folder.folder_id,
          rootFolderName: folder.folder_name,
          category: selection.default_category || "Google Workspace",
          tags: selection.default_tags.length
            ? selection.default_tags
            : ["google", file.mimeType.includes("spreadsheet") ? "sheet" : "doc"],
        });
      }
    }
  }

  // Legacy fallback: no selections anywhere → sync immediate children of active folders
  if (!anySelections) {
    const allSelections = await listAllEnabledSelections();
    if (allSelections.length === 0) {
      for (const folder of folders) {
        const files = await listFilesInFolder(folder.folder_id);
        for (const file of files) {
          if (file.mimeType === GOOGLE_FOLDER_MIME) continue;
          if (seen.has(file.id)) continue;
          seen.add(file.id);
          resolved.push({
            file,
            selection: null,
            reason: "legacy_folder_child",
            rootId: folder.id,
            rootFolderId: folder.folder_id,
            rootFolderName: folder.folder_name,
            category: "Google Workspace",
            tags: ["google", file.mimeType.includes("spreadsheet") ? "sheet" : "doc"],
          });
        }
      }
    }
  }

  return { files: resolved, exclusions, roots: folders };
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
          "Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, then share Drive folders with the service account email.",
      };
    }

    const selections = await listAllEnabledSelections();
    const includes = selections.filter((s) => !s.explicitly_excluded && s.enabled);

    if (active.length === 0) {
      return {
        key: this.key,
        name: this.name,
        status: "warning",
        label: "Needs root",
        lastSyncAt,
        lastError: null,
        itemsSynced,
        details: "Configured, but no Drive root folders are connected yet.",
      };
    }

    if (includes.length === 0) {
      return {
        key: this.key,
        name: this.name,
        status: "warning",
        label: "Needs selection",
        lastSyncAt,
        lastError: null,
        itemsSynced,
        details:
          "Root folder(s) connected. Select files or folders in the Knowledge Manager before syncing.",
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
        details: `${active.length} active root(s), ${includes.length} selection(s)`,
      };
    }

    return {
      key: this.key,
      name: this.name,
      status: "healthy",
      label: "Ready",
      lastSyncAt,
      lastError: null,
      itemsSynced,
      details: `${active.length} root(s), ${includes.length} selection(s)`,
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

  async sync(options?: {
    folderId?: string;
    triggerSource?: "manual" | "cron" | "retry" | "admin";
    jobId?: string | null;
  }): Promise<ConnectorSyncResult & { archived: number; runId: string }> {
    if (!isGoogleWorkspaceConfigured()) {
      throw new GoogleConfigError();
    }

    const startedAt = nowIso();
    const startedMs = Date.now();
    const run = await createSyncRun({
      rootId: options?.folderId ?? null,
      triggerSource: options?.triggerSource ?? "admin",
      jobId: options?.jobId ?? null,
    });

    const result: ConnectorSyncResult & { archived: number; runId: string } = {
      connector: this.key,
      startedAt,
      finishedAt: startedAt,
      scanned: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
      archived: 0,
      runId: run.id,
    };

    const { files, exclusions, roots } = await resolveFilesToSync({
      folderId: options?.folderId,
    });

    const existingEntries = await listAllKnowledgeEntriesForRetrieval();
    const syncedFileIds = new Set<string>();

    for (const item of files) {
      result.scanned += 1;
      const { file, selection, reason, rootId, rootFolderName, category, tags } = item;

      if (reason === "direct_file_access_lost") {
        result.errors.push(`${file.name}: access lost`);
        await upsertSyncedFile({
          root_id: rootId,
          google_file_id: file.id,
          title: file.name,
          mime_type: file.mimeType,
          selection_id: selection?.id ?? null,
          sync_status: "access_lost",
          selected_reason: reason,
          last_error_code: "BAXTER_GOOGLE_FOLDER_ACCESS_DENIED",
          last_error_message_safe: "Service account cannot read this file.",
          last_sync_attempt_at: nowIso(),
        });
        continue;
      }

      if (exclusions.has(file.id)) {
        result.skipped += 1;
        await upsertSyncedFile({
          root_id: rootId,
          google_file_id: file.id,
          title: file.name,
          mime_type: file.mimeType,
          web_view_link: file.webViewLink ?? null,
          sync_status: "excluded",
          selected_reason: "explicit_exclusion",
          selection_id: selection?.id ?? null,
        });
        continue;
      }

      if (!isSupportedGoogleMime(file.mimeType)) {
        result.skipped += 1;
        await upsertSyncedFile({
          root_id: rootId,
          google_file_id: file.id,
          title: file.name,
          mime_type: file.mimeType,
          web_view_link: file.webViewLink ?? null,
          sync_status: "unsupported",
          selected_reason: reason,
          selection_id: selection?.id ?? null,
        });
        continue;
      }

      try {
        const parsed = await parseGoogleDriveFile(file, item.rootFolderId);
        if (!parsed.contentText || parsed.parseMode === "unsupported") {
          result.skipped += 1;
          await upsertSyncedFile({
            root_id: rootId,
            google_file_id: file.id,
            title: file.name,
            mime_type: file.mimeType,
            web_view_link: file.webViewLink ?? null,
            sync_status: parsed.parseMode === "metadata_only" ? "unsupported" : "unsupported",
            selected_reason: reason,
            selection_id: selection?.id ?? null,
            content_hash: parsed.contentHash,
          });
          continue;
        }

        // Preserve admin tags/category when updating
        const existing = findExistingByFileId(existingEntries, parsed.fileId);
        const preserveTags = existing?.tags && existing.tags.length > 0 ? existing.tags : tags;
        const preserveCategory =
          existing?.category && existing.category !== "Google Workspace"
            ? existing.category
            : category;

        const meta = {
          ...(existing?.metadata ?? {}),
          google: {
            fileId: parsed.fileId,
            mimeType: parsed.mimeType,
            revisionOrModified: parsed.modifiedTime,
            contentHash: parsed.contentHash,
            folderId: item.rootFolderId,
            folderName: rootFolderName,
            owner: parsed.owner,
            parseMode: parsed.parseMode,
            lastSyncedAt: nowIso(),
            selectionId: selection?.id ?? null,
            selectedReason: reason,
            managed: true,
          },
          googleManaged: true,
          mimeType: parsed.mimeType,
          originalFilename: parsed.title,
          ...(parsed.workbook
            ? {
                workbook: {
                  title: parsed.workbook.title,
                  sheets: parsed.workbook.sheets.map((s) => ({
                    name: s.name,
                    gid: s.gid,
                    grid: s.rawGrid,
                  })),
                  warnings: parsed.workbook.warnings,
                  truncated: parsed.workbook.truncated,
                },
                structuredIndexed: true,
              }
            : {}),
          ...(parsed.imageUnits?.length
            ? {
                imageUnits: parsed.imageUnits,
                imageMeta: parsed.imageMeta ?? {},
              }
            : {}),
          ...(parsed.imageMeta && !parsed.imageUnits?.length
            ? { imageMeta: parsed.imageMeta }
            : {}),
          ...(parsed.slideUnits?.length ? { slideUnits: parsed.slideUnits } : {}),
          ...(parsed.pdfPages?.length ? { pdfPages: parsed.pdfPages } : {}),
        };

        let knowledgeEntryId: string | null = existing?.id ?? null;

        if (existing) {
          if (previousHash(existing) === parsed.contentHash && existing.status === "approved") {
            result.unchanged += 1;
            knowledgeEntryId = existing.id;
            await upsertSyncedFile({
              root_id: rootId,
              google_file_id: file.id,
              knowledge_entry_id: existing.id,
              title: parsed.title,
              mime_type: parsed.mimeType,
              web_view_link: parsed.webViewLink,
              drive_id: file.driveId ?? null,
              content_hash: parsed.contentHash,
              modified_time: parsed.modifiedTime,
              sync_status: "unchanged",
              selected_reason: reason,
              selection_id: selection?.id ?? null,
              last_synced_at: nowIso(),
              last_sync_attempt_at: nowIso(),
            });
            syncedFileIds.add(file.id);
            continue;
          }

          const updated = await updateKnowledgeEntry(
            existing.id,
            {
              title: parsed.title,
              content: parsed.contentText,
              summary: existing.summary ?? `Synced from Google Workspace`,
              category: preserveCategory,
              tags: preserveTags,
              source_name: rootFolderName,
              source_type: "Google Drive",
              source_url: parsed.webViewLink,
              visibility: "internal",
              change_note: "Google Workspace sync update",
            },
            existing.updated_by ?? existing.created_by ?? "google-sync",
          );

          if (updated.status === "draft" || updated.status === "archived") {
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
          knowledgeEntryId = updated.id;
        } else {
          const created = await createKnowledgeEntry(
            {
              title: parsed.title,
              content: parsed.contentText,
              summary: `Synced from Google Workspace`,
              category: preserveCategory,
              tags: preserveTags,
              source_name: rootFolderName,
              source_type: "Google Drive",
              source_url: parsed.webViewLink,
              visibility: "internal",
              status: "approved",
            },
            selection?.created_by ?? "google-sync",
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
          knowledgeEntryId = created.id;
        }

        // Rebuild retrieval units from structured workbook / document content
        if (knowledgeEntryId) {
          try {
            const { indexKnowledgeEntry } = await import("@/lib/knowledge-index/reindex");
            const { getKnowledgeEntry } = await import("@/lib/knowledge/store");
            const entryForIndex = await getKnowledgeEntry(knowledgeEntryId);
            if (entryForIndex) {
              // Ensure workbook metadata is present for indexing
              if (parsed.workbook && !entryForIndex.metadata?.workbook) {
                await patchKnowledgeEntrySyncFields(knowledgeEntryId, {
                  metadata: {
                    ...entryForIndex.metadata,
                    ...meta,
                  },
                });
                const refreshed = await getKnowledgeEntry(knowledgeEntryId);
                if (refreshed) await indexKnowledgeEntry(refreshed);
              } else {
                await indexKnowledgeEntry({
                  ...entryForIndex,
                  metadata: { ...entryForIndex.metadata, ...meta },
                  content: parsed.contentText ?? entryForIndex.content,
                });
              }
            }
          } catch (indexError) {
            result.errors.push(
              `${file.name}: indexed with warnings (${indexError instanceof Error ? indexError.message.slice(0, 120) : "index failed"})`,
            );
          }
        }

        await upsertSyncedFile({
          root_id: rootId,
          google_file_id: file.id,
          knowledge_entry_id: knowledgeEntryId,
          title: parsed.title,
          mime_type: parsed.mimeType,
          web_view_link: parsed.webViewLink,
          drive_id: file.driveId ?? null,
          content_hash: parsed.contentHash,
          modified_time: parsed.modifiedTime,
          sync_status: "synced",
          selected_reason: reason,
          selection_id: selection?.id ?? null,
          last_synced_at: nowIso(),
          last_sync_attempt_at: nowIso(),
          last_error_code: null,
          last_error_message_safe: null,
        });
        syncedFileIds.add(file.id);
      } catch (fileError) {
        const message = fileError instanceof Error ? fileError.message : "sync failed";
        result.errors.push(`${file.name}: ${message}`);
        await upsertSyncedFile({
          root_id: rootId,
          google_file_id: file.id,
          title: file.name,
          mime_type: file.mimeType,
          web_view_link: file.webViewLink ?? null,
          sync_status: "failed",
          selected_reason: reason,
          selection_id: selection?.id ?? null,
          last_sync_attempt_at: nowIso(),
          last_error_code: "BAXTER_GOOGLE_SYNC_FAILED",
          last_error_message_safe: message.slice(0, 240),
        });
      }
    }

    // Archive KB entries for explicit exclusions that were previously synced
    for (const excludedId of exclusions) {
      const existing = findExistingByFileId(existingEntries, excludedId);
      if (existing && existing.status === "approved") {
        await setKnowledgeEntryStatus(existing.id, "archived", "google-sync");
        result.archived += 1;
        const root = roots[0];
        if (root) {
          await upsertSyncedFile({
            root_id: root.id,
            google_file_id: excludedId,
            title: existing.title,
            knowledge_entry_id: existing.id,
            sync_status: "excluded",
            selected_reason: "explicit_exclusion",
            last_sync_attempt_at: nowIso(),
          });
        }
      }
    }

    for (const folder of roots) {
      await updateGoogleSyncFolder(folder.id, {
        last_sync_at: nowIso(),
        last_success_at: result.errors.length === 0 ? nowIso() : folder.last_success_at,
        last_error: result.errors.length ? result.errors.slice(-1)[0]! : null,
        indexed_document_count: syncedFileIds.size,
        status: result.errors.length && result.created + result.updated === 0 ? "error" : "active",
      });
    }

    result.finishedAt = nowIso();
    const status =
      result.errors.length === 0
        ? "complete"
        : result.created + result.updated + result.unchanged > 0
          ? "partial"
          : "failed";

    await completeSyncRun(run.id, {
      status,
      files_discovered: result.scanned,
      created_count: result.created,
      updated_count: result.updated,
      unchanged_count: result.unchanged,
      archived_count: result.archived,
      failed_count: result.errors.length,
      skipped_count: result.skipped,
      duration_ms: Date.now() - startedMs,
      error_summary: result.errors.slice(0, 5).join("; ") || null,
    });

    return result;
  }
}

export async function resolveAndAddFolder(input: { folderId: string; userId: string }) {
  if (!isGoogleWorkspaceConfigured()) throw new GoogleConfigError();
  const folderId = normalizeGoogleFolderId(input.folderId);
  if (!folderId) {
    throw new GoogleConfigError(
      "A Google folder ID or URL is required.",
      "BAXTER_GOOGLE_ROOT_INVALID",
    );
  }
  try {
    const meta = await getFolderMetadata(folderId);
    return addGoogleSyncFolder({
      folderId: meta.id,
      folderName: meta.name,
      driveId: meta.driveId ?? null,
      userId: input.userId,
    });
  } catch (error) {
    // Shared Drive IDs equal their root folder IDs when accessible; if metadata fails,
    // try matching against drives.list for the connected account.
    const { listSharedDrives } = await import("./drive");
    const drives = await listSharedDrives().catch(() => []);
    const drive = drives.find((d) => d.id === folderId);
    if (drive) {
      return addGoogleSyncFolder({
        folderId: drive.id,
        folderName: drive.name,
        driveId: drive.id,
        userId: input.userId,
      });
    }
    throw error;
  }
}

export async function enqueueOrRunGoogleSync(input: {
  userId: string;
  rootId?: string | null;
  runInline?: boolean;
}): Promise<{
  jobId: string | null;
  runInline: boolean;
  result?: Awaited<ReturnType<GoogleWorkspaceConnector["sync"]>>;
  status: string;
}> {
  const { enqueueJob, listMemoryJobsForTests, usesMemoryJobStore } =
    await import("@/lib/jobs/queue");
  const { createServiceClient } = await import("@/lib/supabase/admin");

  // Prevent overlapping syncs
  if (usesMemoryJobStore()) {
    const pending = listMemoryJobsForTests().some(
      (job) =>
        job.jobType === "google_knowledge_sync" &&
        (job.status === "queued" || job.status === "running"),
    );
    if (pending) {
      throw new GoogleConnectorError("A Google sync is already running or queued.", {
        code: "BAXTER_GOOGLE_SYNC_ALREADY_RUNNING",
        statusCode: 409,
        expose: true,
      });
    }
  } else {
    try {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("report_jobs")
        .select("id")
        .eq("job_type", "google_knowledge_sync")
        .in("status", ["queued", "running"])
        .limit(1);
      if (data && data.length > 0) {
        throw new GoogleConnectorError("A Google sync is already running or queued.", {
          code: "BAXTER_GOOGLE_SYNC_ALREADY_RUNNING",
          statusCode: 409,
          expose: true,
        });
      }
    } catch (error) {
      if (error instanceof GoogleConnectorError) throw error;
    }
  }

  if (input.runInline) {
    const result = await new GoogleWorkspaceConnector().sync({
      folderId: input.rootId ?? undefined,
      triggerSource: "manual",
    });
    return { jobId: null, runInline: true, result, status: "complete" };
  }

  const job = await enqueueJob({
    jobType: "google_knowledge_sync",
    metadata: {
      source: "admin_manual",
      folderId: input.rootId ?? null,
      requestedBy: input.userId,
    },
  });

  return { jobId: job.id, runInline: false, status: "queued" };
}
