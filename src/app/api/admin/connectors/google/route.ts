import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  removeGoogleSyncFolder,
  updateGoogleSyncFolder,
  listGoogleSyncFolders,
} from "@/lib/connectors/google";
import {
  dryRunGoogleSync,
  getGoogleAdminOverview,
  listGoogleSampleFiles,
  testGoogleAuthentication,
  testGoogleRootFolder,
  testGoogleSourceThroughBaxter,
} from "@/lib/connectors/google/diagnostics";
import { browseDriveFolder } from "@/lib/connectors/google/browse";
import { normalizeGoogleFolderId } from "@/lib/connectors/google/folder-id";
import { getEnv } from "@/lib/env";
import {
  listSelectionsForRoot,
  removeSelection,
  setSelectionEnabled,
  upsertSelection,
} from "@/lib/connectors/google/selections";
import {
  getSyncedFileStats,
  listRecentSyncRuns,
  listSyncedFilesForRoot,
} from "@/lib/connectors/google/synced-files";
import { getCronConfigDiagnostics } from "@/lib/jobs/cron-auth";
import { getCronMetricsSnapshot } from "@/lib/jobs/cron-metrics";
import { parseGoogleDriveFile } from "@/lib/connectors/google/parser";
import { getDriveFile } from "@/lib/connectors/google/drive";
import { enqueueOrRunGoogleSync, resolveAndAddFolder } from "@/lib/connectors/google/sync";
import { claimNextJob } from "@/lib/jobs/queue";
import { processJob } from "@/lib/jobs/process";
import { getGoogleCredentialStatus } from "@/lib/connectors/google/auth";

export async function GET() {
  try {
    await requireAdmin();
    const overview = await getGoogleAdminOverview();
    const selections = (
      await Promise.all(overview.folders.map((folder) => listSelectionsForRoot(folder.id)))
    ).flat();
    const syncedStats = await getSyncedFileStats();
    const runs = await listRecentSyncRuns(12);
    const cron = getCronConfigDiagnostics();
    const cronMetrics = getCronMetricsSnapshot();

    return jsonOk({
      ...overview,
      selections,
      syncedStats,
      runs,
      cron: { ...cron, ...cronMetrics },
      identityNotice:
        "Google API access is performed by GOOGLE_CLIENT_EMAIL. Ensure the selected folder or Shared Drive is shared with that service-account address unless domain-wide delegation is configured.",
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/connectors/google");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = z
      .object({
        action: z.enum([
          "add_folder",
          "remove_folder",
          "pause",
          "resume",
          "sync",
          "test_auth",
          "test_root_folder",
          "list_sample_files",
          "dry_run_sync",
          "test_google_through_baxter",
          "browse",
          "add_selection",
          "exclude_selection",
          "remove_selection",
          "toggle_selection",
          "preview_file",
          "list_synced_files",
          "process_one_job",
        ]),
        folderId: z.string().optional(),
        id: z.string().uuid().optional(),
        rootId: z.string().uuid().optional(),
        currentFolderId: z.string().optional(),
        search: z.string().optional(),
        sort: z.enum(["name", "modified"]).optional(),
        fileType: z.enum(["all", "docs", "sheets", "folders", "supported"]).optional(),
        googleFileId: z.string().optional(),
        selectionType: z.enum(["file", "folder"]).optional(),
        recursive: z.boolean().optional(),
        includeFutureFiles: z.boolean().optional(),
        title: z.string().optional(),
        mimeType: z.string().optional(),
        driveId: z.string().optional().nullable(),
        parentFileId: z.string().optional().nullable(),
        defaultCategory: z.string().optional().nullable(),
        defaultTags: z.array(z.string()).optional(),
        enabled: z.boolean().optional(),
        selectionId: z.string().uuid().optional(),
      })
      .parse(body);

    if (parsed.action === "add_folder") {
      if (!parsed.folderId) throw new Error("folderId is required");
      const folder = await resolveAndAddFolder({
        folderId: parsed.folderId,
        userId: user.id,
      });
      return jsonOk({ folder }, { status: 201 });
    }

    if (parsed.action === "remove_folder") {
      if (!parsed.id) throw new Error("id is required");
      await removeGoogleSyncFolder(parsed.id);
      return jsonOk({ deleted: true });
    }

    if (parsed.action === "pause" || parsed.action === "resume") {
      if (!parsed.id) throw new Error("id is required");
      const folder = await updateGoogleSyncFolder(parsed.id, {
        status: parsed.action === "pause" ? "paused" : "active",
      });
      return jsonOk({ folder });
    }

    if (parsed.action === "sync") {
      const result = await enqueueOrRunGoogleSync({
        userId: user.id,
        rootId: parsed.id ?? parsed.rootId,
        runInline: true,
      });
      return jsonOk({ result: result.result, status: result.status });
    }

    if (parsed.action === "test_auth") {
      return jsonOk({ result: await testGoogleAuthentication() });
    }
    if (parsed.action === "test_root_folder") {
      return jsonOk({ result: await testGoogleRootFolder() });
    }
    if (parsed.action === "list_sample_files") {
      return jsonOk({ result: await listGoogleSampleFiles() });
    }
    if (parsed.action === "dry_run_sync") {
      return jsonOk({ result: await dryRunGoogleSync() });
    }
    if (parsed.action === "test_google_through_baxter") {
      return jsonOk({ result: await testGoogleSourceThroughBaxter(user.id) });
    }

    if (parsed.action === "browse") {
      const env = getEnv();
      const roots = await listGoogleSyncFolders();
      const root =
        (parsed.rootId ? roots.find((r) => r.id === parsed.rootId) : null) ??
        roots.find((r) => r.status === "active") ??
        roots[0];
      const rootFolderId =
        root?.folder_id || normalizeGoogleFolderId(env.GOOGLE_DRIVE_ROOT_FOLDER || "") || "";
      if (!rootFolderId) {
        return jsonOk({
          result: {
            pass: false,
            message: "Connect a root folder first (GOOGLE_DRIVE_ROOT_FOLDER or Add folder).",
          },
        });
      }
      const browse = await browseDriveFolder({
        rootFolderId,
        folderId: parsed.currentFolderId || rootFolderId,
        search: parsed.search,
        sort: parsed.sort,
        fileType: parsed.fileType,
      });
      const selections = root ? await listSelectionsForRoot(root.id) : [];
      return jsonOk({
        result: {
          ...browse,
          rootId: root?.id ?? null,
          rootFolderId,
          selections,
          credentials: getGoogleCredentialStatus(),
        },
      });
    }

    if (parsed.action === "add_selection" || parsed.action === "exclude_selection") {
      if (!parsed.rootId || !parsed.googleFileId || !parsed.selectionType) {
        throw new Error("rootId, googleFileId, and selectionType are required");
      }
      const selection = await upsertSelection({
        rootId: parsed.rootId,
        googleFileId: parsed.googleFileId,
        selectionType: parsed.selectionType,
        recursive: parsed.recursive,
        includeFutureFiles: parsed.includeFutureFiles,
        explicitlyExcluded: parsed.action === "exclude_selection",
        enabled: true,
        titleSnapshot: parsed.title,
        mimeType: parsed.mimeType,
        driveId: parsed.driveId,
        parentFileId: parsed.parentFileId,
        defaultCategory: parsed.defaultCategory,
        defaultTags: parsed.defaultTags,
        userId: user.id,
      });
      return jsonOk({ selection });
    }

    if (parsed.action === "remove_selection") {
      if (!parsed.selectionId) throw new Error("selectionId is required");
      const { listAllKnowledgeEntriesForRetrieval, setKnowledgeEntryStatus } =
        await import("@/lib/knowledge/store");
      const { listSelectionsForRoot: listSel } = await import("@/lib/connectors/google/selections");
      // Find selection before delete to archive linked KB entry
      const roots = await listGoogleSyncFolders();
      let fileId: string | null = null;
      for (const root of roots) {
        const sels = await listSel(root.id);
        const found = sels.find((s) => s.id === parsed.selectionId);
        if (found) {
          fileId = found.google_file_id;
          break;
        }
      }
      await removeSelection(parsed.selectionId);
      if (fileId) {
        const entries = await listAllKnowledgeEntriesForRetrieval();
        const existing = entries.find(
          (e) => e.source_type === "Google Drive" && e.source_external_id === fileId,
        );
        if (existing && existing.status === "approved") {
          await setKnowledgeEntryStatus(existing.id, "archived", user.id);
        }
      }
      return jsonOk({ deleted: true, archived: Boolean(fileId) });
    }

    if (parsed.action === "toggle_selection") {
      if (!parsed.selectionId || parsed.enabled === undefined) {
        throw new Error("selectionId and enabled are required");
      }
      await setSelectionEnabled(parsed.selectionId, parsed.enabled);
      return jsonOk({ updated: true });
    }

    if (parsed.action === "preview_file") {
      if (!parsed.googleFileId) throw new Error("googleFileId is required");
      const file = await getDriveFile(parsed.googleFileId);
      const parsedFile = await parseGoogleDriveFile(file, parsed.parentFileId ?? null);
      const previewText = (parsedFile.contentText ?? "").slice(0, 2500);
      const truncated = (parsedFile.contentText?.length ?? 0) > 2500;
      return jsonOk({
        result: {
          title: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink ?? null,
          modifiedTime: file.modifiedTime ?? null,
          parseMode: parsedFile.parseMode,
          estimatedChars: parsedFile.contentText?.length ?? 0,
          previewText,
          truncated,
          supported: parsedFile.parseMode === "full_text",
          metadataOnly: parsedFile.parseMode === "metadata_only",
        },
      });
    }

    if (parsed.action === "list_synced_files") {
      if (!parsed.rootId) throw new Error("rootId is required");
      const files = await listSyncedFilesForRoot(parsed.rootId);
      return jsonOk({ files });
    }

    if (parsed.action === "process_one_job") {
      const job = await claimNextJob({ jobTypes: ["google_knowledge_sync"] });
      if (!job) {
        return jsonOk({ processed: false, message: "No pending google_knowledge_sync jobs." });
      }
      const outcome = await processJob(job);
      return jsonOk({ processed: true, jobId: job.id, outcome });
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/google");
  }
}
