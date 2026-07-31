import "server-only";

import { GOOGLE_FOLDER_MIME } from "@/lib/connectors/google/types";
import {
  GOOGLE_SHORTCUT_MIME,
  copyFile,
  countDriveTree,
  createFolder,
  findChildByName,
  listChildren,
  type TreeCounts,
} from "@/lib/connectors/google/writes";

export type SkippedShortcut = { id: string; name: string; parentId: string };
export type ExcludedFile = { id: string; name: string; reason: string };

export type FolderCopyProgress = {
  destinationFolderId: string;
  destinationFolderLink: string | null;
  copiedFiles: number;
  createdFolders: number;
  skipped: SkippedShortcut[];
  excluded: ExcludedFile[];
};

export type FolderCopyResult = FolderCopyProgress & {
  verification: {
    source: TreeCounts;
    destination: TreeCounts;
    expectedDestination: TreeCounts;
    excludedFileCount: number;
    match: boolean;
    diff: string[];
  };
};

/**
 * Recursively mirror a Drive folder tree into destinationParent as `folderName`.
 * Idempotent: reuses destinationFolderId from prior progress; copies only missing names.
 * Loud failure if a same-named folder exists under the parent without prior progress.
 * `excludeFileIds` are skipped by ID (e.g. Project Charter Master living inside the template).
 */
export async function copyTemplateFolderTree(input: {
  templateFolderId: string;
  projectsParentFolderId: string;
  folderName: string;
  /** From a prior partial attempt of this run's step. */
  priorDestinationFolderId?: string | null;
  /** File IDs to skip during the mirror (matched by ID, not name). */
  excludeFileIds?: string[];
  onProgress?: (progress: FolderCopyProgress) => Promise<void>;
}): Promise<FolderCopyResult> {
  const excludeIds = new Set((input.excludeFileIds ?? []).map((id) => id.trim()).filter(Boolean));
  const skipped: SkippedShortcut[] = [];
  const excluded: ExcludedFile[] = [];
  let copiedFiles = 0;
  let createdFolders = 0;

  let destinationFolderId = input.priorDestinationFolderId?.trim() || null;
  let destinationFolderLink: string | null = null;

  if (destinationFolderId) {
    // Reuse folder created earlier in this run.
  } else {
    const existing = await findChildByName(input.projectsParentFolderId, input.folderName);
    if (existing) {
      if (existing.mimeType !== GOOGLE_FOLDER_MIME) {
        throw new Error(
          `A non-folder item named "${input.folderName}" already exists under 02 Projects. Rename or remove it, then retry.`,
        );
      }
      throw new Error(
        `A folder named "${input.folderName}" already exists under 02 Projects, but this setup run did not create it. Rename or remove that folder (or finish the earlier run), then retry — Baxter will not merge into an unknown folder.`,
      );
    }
    const created = await createFolder({
      name: input.folderName,
      parentId: input.projectsParentFolderId,
    });
    destinationFolderId = created.id;
    destinationFolderLink = created.webViewLink ?? null;
    createdFolders += 1;
  }

  if (!destinationFolderLink) {
    const meta = await findChildByName(input.projectsParentFolderId, input.folderName);
    destinationFolderLink = meta?.webViewLink ?? null;
  }

  async function persist() {
    if (!input.onProgress || !destinationFolderId) return;
    await input.onProgress({
      destinationFolderId,
      destinationFolderLink,
      copiedFiles,
      createdFolders,
      skipped: [...skipped],
      excluded: [...excluded],
    });
  }

  await persist();

  async function mirrorFolder(sourceFolderId: string, destFolderId: string): Promise<void> {
    const [sourceChildren, destChildren] = await Promise.all([
      listChildren(sourceFolderId),
      listChildren(destFolderId),
    ]);
    const destByName = new Map(destChildren.map((c) => [c.name, c]));

    for (const child of sourceChildren) {
      if (excludeIds.has(child.id)) {
        excluded.push({
          id: child.id,
          name: child.name,
          reason: "master_charter_spreadsheet",
        });
        continue;
      }

      if (child.mimeType === GOOGLE_SHORTCUT_MIME) {
        skipped.push({ id: child.id, name: child.name, parentId: sourceFolderId });
        continue;
      }

      if (child.mimeType === GOOGLE_FOLDER_MIME) {
        let destSub = destByName.get(child.name);
        if (!destSub) {
          destSub = await createFolder({ name: child.name, parentId: destFolderId });
          createdFolders += 1;
          destByName.set(child.name, destSub);
          await persist();
        } else if (destSub.mimeType !== GOOGLE_FOLDER_MIME) {
          throw new Error(
            `Cannot mirror folder "${child.name}" — a non-folder with that name already exists in the destination.`,
          );
        }
        await mirrorFolder(child.id, destSub.id);
        continue;
      }

      const existingFile = destByName.get(child.name);
      if (existingFile) {
        continue; // already copied on a prior attempt
      }
      const copied = await copyFile({
        fileId: child.id,
        name: child.name,
        parentId: destFolderId,
      });
      destByName.set(child.name, copied);
      copiedFiles += 1;
      await persist();
    }
  }

  await mirrorFolder(input.templateFolderId, destinationFolderId);

  const sourceCounts = await countDriveTree(input.templateFolderId);
  const destCounts = await countDriveTree(destinationFolderId);
  // Source count minus excluded files (and shortcuts we never copy) = expected destination.
  const expectedDest: TreeCounts = {
    folders: sourceCounts.folders,
    files: Math.max(0, sourceCounts.files - excluded.length),
    shortcuts: 0,
  };

  const diff: string[] = [];
  if (destCounts.folders !== expectedDest.folders) {
    diff.push(
      `folders: expected ${expectedDest.folders} (source ${sourceCounts.folders}) vs destination ${destCounts.folders}`,
    );
  }
  if (destCounts.files !== expectedDest.files) {
    diff.push(
      `files: expected ${expectedDest.files} (source ${sourceCounts.files} − ${excluded.length} excluded) vs destination ${destCounts.files}`,
    );
  }
  if (destCounts.shortcuts !== 0) {
    diff.push(`unexpected shortcuts in destination: ${destCounts.shortcuts}`);
  }

  if (diff.length > 0) {
    throw new Error(
      `Folder copy verification failed after mirroring "${input.folderName}". ${diff.join("; ")}. Skipped ${skipped.length} shortcut(s); excluded ${excluded.length} file(s).`,
    );
  }

  return {
    destinationFolderId,
    destinationFolderLink,
    copiedFiles,
    createdFolders,
    skipped,
    excluded,
    verification: {
      source: sourceCounts,
      destination: destCounts,
      expectedDestination: expectedDest,
      excludedFileCount: excluded.length,
      match: true,
      diff: [],
    },
  };
}
