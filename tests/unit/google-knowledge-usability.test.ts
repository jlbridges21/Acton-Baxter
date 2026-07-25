import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

describe("Google Drive XLSX support", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
  });

  it("treats XLSX MIME as supported", async () => {
    const { isSupportedGoogleMime } = await import("@/lib/connectors/google/parser");
    expect(
      isSupportedGoogleMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(true);
    expect(isSupportedGoogleMime("application/vnd.ms-excel")).toBe(true);
    expect(isSupportedGoogleMime("text/csv")).toBe(true);
  });
});

describe("Google root persistence", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    const { resetGoogleFoldersMemoryForTests } = await import("@/lib/connectors/google/folders");
    resetGoogleFoldersMemoryForTests();
  });

  it("reuses an already-connected Shared Drive without duplicating", async () => {
    const { addGoogleSyncFolder, listGoogleSyncFolders } =
      await import("@/lib/connectors/google/folders");
    const first = await addGoogleSyncFolder({
      folderId: "drive-acton",
      folderName: "Acton ADU",
      driveId: "drive-acton",
      userId: "user-1",
    });
    const second = await addGoogleSyncFolder({
      folderId: "drive-acton",
      folderName: "Acton ADU",
      driveId: "drive-acton",
      userId: "user-1",
    });
    expect(second.id).toBe(first.id);
    expect(first.is_primary).toBe(true);
    const all = await listGoogleSyncFolders();
    expect(all.filter((f) => f.folder_id === "drive-acton")).toHaveLength(1);
  });

  it("marks a newly connected root as primary", async () => {
    const { addGoogleSyncFolder, getPrimaryGoogleSyncFolder } =
      await import("@/lib/connectors/google/folders");
    await addGoogleSyncFolder({
      folderId: "root-a",
      folderName: "Drive A",
      userId: "user-1",
    });
    const primary = await getPrimaryGoogleSyncFolder();
    expect(primary?.folder_id).toBe("root-a");
  });
});

describe("Add / remove from Baxter", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    const { resetGoogleFoldersMemoryForTests } = await import("@/lib/connectors/google/folders");
    const { resetGoogleSelectionsMemoryForTests } =
      await import("@/lib/connectors/google/selections");
    resetGoogleFoldersMemoryForTests();
    resetGoogleSelectionsMemoryForTests();
  });

  it("creates selections when adding files to Baxter", async () => {
    const { addGoogleSyncFolder } = await import("@/lib/connectors/google/folders");
    const root = await addGoogleSyncFolder({
      folderId: "drive-1",
      folderName: "Acton ADU",
      userId: "admin-1",
    });

    const { upsertSelection, listSelectionsForRoot } =
      await import("@/lib/connectors/google/selections");
    await upsertSelection({
      rootId: root.id,
      googleFileId: "file-xlsx-1",
      selectionType: "file",
      enabled: true,
      explicitlyExcluded: false,
      titleSnapshot: "Rates.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      userId: "admin-1",
    });
    const sels = await listSelectionsForRoot(root.id);
    expect(sels).toHaveLength(1);
    expect(sels[0]?.google_file_id).toBe("file-xlsx-1");
    expect(sels[0]?.enabled).toBe(true);
  });

  it("disables selection when removing from Baxter", async () => {
    const { addGoogleSyncFolder } = await import("@/lib/connectors/google/folders");
    const { upsertSelection, listSelectionsForRoot } =
      await import("@/lib/connectors/google/selections");
    const { removeFilesFromBaxter } = await import("@/lib/connectors/google/add-remove");

    const root = await addGoogleSyncFolder({
      folderId: "drive-2",
      folderName: "Acton ADU",
      userId: "admin-1",
    });
    await upsertSelection({
      rootId: root.id,
      googleFileId: "doc-1",
      selectionType: "file",
      enabled: true,
      explicitlyExcluded: false,
      titleSnapshot: "Policy",
      userId: "admin-1",
    });

    await removeFilesFromBaxter({
      rootId: root.id,
      userId: "admin-1",
      googleFileIds: ["doc-1"],
    });

    const sels = await listSelectionsForRoot(root.id);
    expect(sels.find((s) => s.google_file_id === "doc-1")?.enabled).toBe(false);
  });
});

describe("Google knowledge reconcile", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    const { resetGoogleFoldersMemoryForTests } = await import("@/lib/connectors/google/folders");
    const { resetGoogleSelectionsMemoryForTests } =
      await import("@/lib/connectors/google/selections");
    resetGoogleFoldersMemoryForTests();
    resetGoogleSelectionsMemoryForTests();
  });

  it("reports selected files without synced records", async () => {
    const { addGoogleSyncFolder } = await import("@/lib/connectors/google/folders");
    const { upsertSelection } = await import("@/lib/connectors/google/selections");
    const { reconcileGoogleKnowledgeState } = await import("@/lib/connectors/google/reconcile");

    const root = await addGoogleSyncFolder({
      folderId: "drive-3",
      folderName: "Acton ADU",
      userId: "admin-1",
    });
    await upsertSelection({
      rootId: root.id,
      googleFileId: "orphan-file",
      selectionType: "file",
      enabled: true,
      explicitlyExcluded: false,
      titleSnapshot: "Orphan",
      userId: "admin-1",
    });

    const result = await reconcileGoogleKnowledgeState({
      rootId: root.id,
      repair: false,
      userId: "admin-1",
    });
    expect(result.issues.some((i) => i.code === "SELECTED_WITHOUT_SYNCED_FILE")).toBe(true);
  });
});
