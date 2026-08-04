/**
 * One-time user Drive → Knowledge draft ingest.
 * Does NOT write google_source_selections or google_synced_files.
 */

import "server-only";

import { after } from "next/server";
import {
  claimJobById,
  completeJob,
  enqueueJob,
  failJob,
  getJobById,
  patchJobMetadata,
  usesMemoryJobStore,
} from "@/lib/jobs/queue";
import { createKnowledgeEntry, patchKnowledgeEntrySyncFields } from "@/lib/knowledge/store";
import { getDriveFile } from "@/lib/connectors/google/drive";
import {
  parseGoogleDriveFile,
  isSupportedGoogleMime,
  unsupportedMimeReason,
} from "@/lib/connectors/google/parser";
import { getPrimaryGoogleSyncFolder, listGoogleSyncFolders } from "@/lib/connectors/google/folders";
import { listSelectionsForRoot } from "@/lib/connectors/google/selections";
import {
  browseDriveFolder,
  buildBreadcrumbs,
  type BrowseItem,
} from "@/lib/connectors/google/browse";
import { GoogleConnectorError } from "@/lib/connectors/google/errors";
import { GOOGLE_FOLDER_MIME } from "@/lib/connectors/google/types";
import { ValidationError } from "@/lib/errors";

export type DriveIngestFileResult = {
  googleFileId: string;
  title: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  knowledgeEntryId?: string | null;
  error?: string | null;
};

export type DriveIngestProgress = {
  status: "queued" | "running" | "complete" | "failed";
  userId: string;
  rootFolderId: string;
  files: DriveIngestFileResult[];
  createdCount: number;
  failedCount: number;
};

/**
 * Curated browse roots for non-admins:
 * enabled folder selections under the primary connected Drive, else the Drive root itself.
 * Never exposes browse_my_drive / arbitrary connection scope.
 */
export async function resolveUserDriveBrowseRoots(): Promise<{
  rootFolderId: string;
  rootName: string;
  allowedRootIds: string[];
  scopeNote: string;
}> {
  const primary = await getPrimaryGoogleSyncFolder();
  if (!primary || primary.status !== "active") {
    throw new GoogleConnectorError(
      "Google Drive is not connected yet. Ask an admin to connect the Acton Drive in Connectors.",
      { code: "GOOGLE_NOT_CONNECTED", statusCode: 503, expose: true },
    );
  }

  const selections = (await listSelectionsForRoot(primary.id)).filter(
    (s) => s.enabled && !s.explicitly_excluded && s.selection_type === "folder",
  );

  if (selections.length > 0) {
    return {
      rootFolderId: primary.folder_id,
      rootName: primary.folder_name,
      allowedRootIds: selections.map((s) => s.google_file_id),
      scopeNote:
        "Browsing folders an admin has made available for Baxter. This is a one-time snapshot — it will not stay in sync with future Drive edits.",
    };
  }

  return {
    rootFolderId: primary.folder_id,
    rootName: primary.folder_name,
    allowedRootIds: [primary.folder_id],
    scopeNote:
      "Browsing the admin-connected Drive. This is a one-time snapshot — it will not stay in sync with future Drive edits.",
  };
}

async function assertFolderAllowed(folderId: string, allowedRootIds: string[]): Promise<void> {
  if (allowedRootIds.includes(folderId)) return;
  // Walk parents until we hit an allowed root or escape.
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (allowedRootIds.includes(cursor)) return;
    const meta = await getDriveFile(cursor);
    cursor = meta.parents?.[0] ?? null;
    if (seen.size > 25) break;
  }
  throw new GoogleConnectorError("That folder is outside the admin-curated Drive libraries.", {
    code: "GOOGLE_FOLDER_OUT_OF_SCOPE",
    statusCode: 403,
    expose: true,
  });
}

export async function browseUserCuratedDrive(input: {
  folderId?: string | null;
  search?: string | null;
}): Promise<{
  currentFolderId: string;
  currentFolderName: string;
  breadcrumbs: Array<{ id: string; name: string }>;
  items: BrowseItem[];
  scopeNote: string;
  libraryRoots: Array<{ id: string; name: string }>;
}> {
  const scope = await resolveUserDriveBrowseRoots();
  const folderId = input.folderId?.trim() || scope.allowedRootIds[0]!;
  await assertFolderAllowed(folderId, scope.allowedRootIds);

  // Prefer breadcrumb from nearest allowed ancestor
  let crumbRoot = scope.allowedRootIds[0]!;
  for (const allowed of scope.allowedRootIds) {
    try {
      const crumbs = await buildBreadcrumbs(folderId, allowed);
      if (crumbs.some((c) => c.id === allowed)) {
        crumbRoot = allowed;
        break;
      }
    } catch {
      // try next
    }
  }

  const browse = await browseDriveFolder({
    rootFolderId: crumbRoot,
    folderId,
    search: input.search,
    fileType: "all",
    sort: "name",
  });

  const libraryRoots: Array<{ id: string; name: string }> = [];
  for (const id of scope.allowedRootIds) {
    try {
      const meta = await getDriveFile(id);
      libraryRoots.push({ id: meta.id, name: meta.name });
    } catch {
      libraryRoots.push({ id, name: id });
    }
  }

  return {
    currentFolderId: browse.currentFolderId,
    currentFolderName: browse.currentFolderName,
    breadcrumbs: browse.breadcrumbs,
    items: browse.items.filter((i) => i.isFolder || i.supported),
    scopeNote: scope.scopeNote,
    libraryRoots,
  };
}

export async function ingestOneDriveFileAsDraft(input: {
  googleFileId: string;
  userId: string;
  rootFolderId: string;
}): Promise<{ knowledgeEntryId: string; title: string }> {
  const file = await getDriveFile(input.googleFileId);
  if (file.mimeType === GOOGLE_FOLDER_MIME) {
    throw new ValidationError("Select files, not folders.");
  }
  if (!isSupportedGoogleMime(file.mimeType)) {
    throw new ValidationError(unsupportedMimeReason(file.mimeType));
  }

  const parsed = await parseGoogleDriveFile(file, input.rootFolderId);
  if (!parsed.contentText?.trim() || parsed.parseMode === "unsupported") {
    throw new ValidationError(
      parsed.parseMode === "metadata_only"
        ? "Baxter could not extract usable text from this file."
        : unsupportedMimeReason(file.mimeType),
    );
  }

  const created = await createKnowledgeEntry(
    {
      title: parsed.title,
      content: parsed.contentText,
      summary: "Imported from Google Drive (one-time snapshot — not kept in sync)",
      category: "Google Workspace",
      tags: ["google-drive", "one-time-import"],
      source_name: "Google Drive (one-time)",
      source_type: "Google Drive",
      source_url: parsed.webViewLink,
      visibility: "internal",
      status: "draft",
    },
    input.userId,
  );

  const meta = {
    google: {
      fileId: parsed.fileId,
      mimeType: parsed.mimeType,
      revisionOrModified: parsed.modifiedTime,
      contentHash: parsed.contentHash,
      folderId: input.rootFolderId,
      owner: parsed.owner,
      parseMode: parsed.parseMode,
      managed: false,
      oneTimeIngest: true,
      ingestedAt: new Date().toISOString(),
      ingestedBy: input.userId,
    },
    googleManaged: false,
    oneTimeDriveIngest: true,
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
      ? { imageUnits: parsed.imageUnits, imageMeta: parsed.imageMeta ?? {} }
      : {}),
    ...(parsed.slideUnits?.length ? { slideUnits: parsed.slideUnits } : {}),
    ...(parsed.pdfPages?.length ? { pdfPages: parsed.pdfPages } : {}),
  };

  await patchKnowledgeEntrySyncFields(created.id, {
    source_external_id: parsed.fileId,
    source_url: parsed.webViewLink,
    metadata: meta,
  });

  return { knowledgeEntryId: created.id, title: parsed.title };
}

function progressFromMeta(meta: Record<string, unknown>): DriveIngestProgress {
  const files = (Array.isArray(meta.files) ? meta.files : []) as DriveIngestFileResult[];
  return {
    status: (meta.ingestStatus as DriveIngestProgress["status"]) ?? "queued",
    userId: String(meta.userId ?? ""),
    rootFolderId: String(meta.rootFolderId ?? ""),
    files,
    createdCount: files.filter((f) => f.status === "complete").length,
    failedCount: files.filter((f) => f.status === "failed" || f.status === "skipped").length,
  };
}

export async function getDriveIngestProgress(jobId: string): Promise<DriveIngestProgress | null> {
  const job = await getJobById(jobId);
  if (!job || job.jobType !== "knowledge_drive_ingest") return null;
  const progress = progressFromMeta(job.metadata);
  if (job.status === "complete" && progress.status !== "complete") {
    return { ...progress, status: "complete" };
  }
  if (job.status === "failed" && progress.status === "running") {
    return { ...progress, status: "failed" };
  }
  return progress;
}

export async function runKnowledgeDriveIngestJob(jobId: string): Promise<void> {
  const job = await getJobById(jobId);
  if (!job) return;
  const userId = String(job.metadata.userId ?? "");
  const rootFolderId = String(job.metadata.rootFolderId ?? "");
  let files = (
    Array.isArray(job.metadata.files) ? job.metadata.files : []
  ) as DriveIngestFileResult[];

  await patchJobMetadata(jobId, { ingestStatus: "running" });

  for (let i = 0; i < files.length; i += 1) {
    const current = files[i]!;
    if (current.status === "complete" || current.status === "failed") continue;

    files = files.map((f, idx) =>
      idx === i ? { ...f, status: "running" as const, error: null } : f,
    );
    await patchJobMetadata(jobId, { files, ingestStatus: "running" });

    try {
      const result = await ingestOneDriveFileAsDraft({
        googleFileId: current.googleFileId,
        userId,
        rootFolderId,
      });
      files = files.map((f, idx) =>
        idx === i
          ? {
              ...f,
              status: "complete" as const,
              title: result.title,
              knowledgeEntryId: result.knowledgeEntryId,
              error: null,
            }
          : f,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ingest failed";
      files = files.map((f, idx) =>
        idx === i ? { ...f, status: "failed" as const, error: message } : f,
      );
    }
    await patchJobMetadata(jobId, { files, ingestStatus: "running" });
  }

  const anyOk = files.some((f) => f.status === "complete");
  await patchJobMetadata(jobId, {
    files,
    ingestStatus: anyOk ? "complete" : "failed",
    createdCount: files.filter((f) => f.status === "complete").length,
    failedCount: files.filter((f) => f.status === "failed").length,
  });

  if (!anyOk) {
    throw new Error("All selected Drive files failed to import");
  }
}

/**
 * Enqueue durable ingest + after() runner (cron backup via processQueuedJobs).
 */
export async function enqueueUserDriveIngest(input: {
  userId: string;
  googleFileIds: string[];
}): Promise<{ jobId: string }> {
  const ids = [...new Set(input.googleFileIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new ValidationError("Select at least one Drive file.");
  }
  if (ids.length > 25) {
    throw new ValidationError("Select at most 25 files at a time.");
  }

  const scope = await resolveUserDriveBrowseRoots();
  // Validate each file is under curated scope (parent walk).
  const files: DriveIngestFileResult[] = [];
  for (const googleFileId of ids) {
    const file = await getDriveFile(googleFileId);
    if (file.mimeType === GOOGLE_FOLDER_MIME) {
      throw new ValidationError(`“${file.name}” is a folder — select individual files.`);
    }
    const parent = file.parents?.[0];
    if (parent) {
      await assertFolderAllowed(parent, scope.allowedRootIds);
    } else {
      // File with no parents: only allow if it is itself an enabled file selection under root
      await assertFolderAllowed(scope.allowedRootIds[0]!, scope.allowedRootIds);
    }
    files.push({
      googleFileId,
      title: file.name,
      status: "pending",
    });
  }

  const job = await enqueueJob({
    reportId: null,
    jobType: "knowledge_drive_ingest",
    metadata: {
      userId: input.userId,
      rootFolderId: scope.rootFolderId,
      ingestStatus: "queued",
      files,
    },
  });

  const run = async () => {
    const claimed = await claimJobById(job.id);
    if (!claimed) return;
    try {
      await runKnowledgeDriveIngestJob(claimed.id);
      await completeJob(claimed.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Drive ingest failed";
      await failJob(claimed.id, message);
    }
  };

  if (usesMemoryJobStore()) {
    await run();
  } else {
    after(run);
  }

  return { jobId: job.id };
}

/** Test helper: ensure primary folder exists in memory. */
export async function ensureTestGoogleRootForIngest(input?: {
  folderId?: string;
  folderName?: string;
}): Promise<string> {
  const { addGoogleSyncFolder } = await import("@/lib/connectors/google/folders");
  const existing = await listGoogleSyncFolders();
  if (existing[0]) return existing[0].folder_id;
  const row = await addGoogleSyncFolder({
    folderId: input?.folderId ?? "root-folder-1",
    folderName: input?.folderName ?? "Acton ADU",
    userId: "00000000-0000-4000-8000-0000000000ad",
    makePrimary: true,
  });
  return row.folder_id;
}
