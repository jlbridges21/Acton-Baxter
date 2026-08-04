import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetMemoryJobsForTests, listMemoryJobsForTests } from "@/lib/jobs/queue";
import {
  listKnowledgeEntries,
  resetKnowledgeMemoryForTests,
  setKnowledgeEntryStatus,
} from "@/lib/knowledge/store";
import {
  canUserReadKnowledgeEntry,
  filterKnowledgeVisibleToUser,
} from "@/lib/knowledge/permissions";
import {
  enqueueUserDriveIngest,
  ensureTestGoogleRootForIngest,
  getDriveIngestProgress,
  ingestOneDriveFileAsDraft,
} from "@/lib/knowledge/user-drive-ingest";
import { resetGoogleFoldersMemoryForTests } from "@/lib/connectors/google/folders";
import {
  resetGoogleSelectionsMemoryForTests,
  listSelectionsForRoot,
} from "@/lib/connectors/google/selections";
import {
  listSyncedFilesForRoot,
  resetGoogleSyncedMemoryForTests,
} from "@/lib/connectors/google/synced-files";

vi.mock("@/lib/connectors/google/drive", () => ({
  getDriveFile: vi.fn(async (id: string) => {
    if (id === "unsupported-1") {
      return {
        id,
        name: "video.mp4",
        mimeType: "video/mp4",
        parents: ["root-folder-1"],
        webViewLink: "https://drive.google.com/file/d/unsupported-1",
      };
    }
    if (id === "doc-fail") {
      return {
        id,
        name: "Broken.doc",
        mimeType: "application/vnd.google-apps.document",
        parents: ["root-folder-1"],
        webViewLink: "https://docs.google.com/document/d/doc-fail",
      };
    }
    return {
      id,
      name: id === "doc-2" ? "Second Doc" : "First Doc",
      mimeType: "application/vnd.google-apps.document",
      parents: ["root-folder-1"],
      webViewLink: `https://docs.google.com/document/d/${id}`,
      modifiedTime: "2026-07-01T00:00:00.000Z",
      owners: [{ displayName: "Acton" }],
    };
  }),
  listFilesInFolder: vi.fn(async () => []),
  exportDriveFile: vi.fn(async () => "Exported body"),
  downloadDriveFileBytes: vi.fn(),
}));

vi.mock("@/lib/connectors/google/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/google/parser")>();
  return {
    ...actual,
    parseGoogleDriveFile: vi.fn(async (file: { id: string; name: string; mimeType: string }) => {
      if (file.id === "doc-fail") {
        throw new Error("parse exploded");
      }
      if (file.mimeType.startsWith("video/")) {
        return {
          fileId: file.id,
          title: file.name,
          mimeType: file.mimeType,
          webViewLink: null,
          modifiedTime: null,
          owner: null,
          folderId: "root-folder-1",
          contentText: "",
          contentHash: "x",
          parseMode: "unsupported" as const,
        };
      }
      return {
        fileId: file.id,
        title: file.name,
        mimeType: file.mimeType,
        webViewLink: `https://docs.google.com/document/d/${file.id}`,
        modifiedTime: "2026-07-01T00:00:00.000Z",
        owner: "Acton",
        folderId: "root-folder-1",
        contentText: `Parsed content for ${file.name}`,
        contentHash: `hash-${file.id}`,
        parseMode: "full_text" as const,
      };
    }),
  };
});

const USER = "00000000-0000-4000-8000-0000000000aa";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  resetEnvCacheForTests();
  resetKnowledgeMemoryForTests();
  resetMemoryJobsForTests();
  resetGoogleFoldersMemoryForTests();
  resetGoogleSelectionsMemoryForTests();
  resetGoogleSyncedMemoryForTests();
});

describe("one-time user Drive ingest", () => {
  it("creates a single draft authored by the selecting user with parsed content", async () => {
    await ensureTestGoogleRootForIngest();
    const result = await ingestOneDriveFileAsDraft({
      googleFileId: "doc-1",
      userId: USER,
      rootFolderId: "root-folder-1",
    });

    const entries = await listKnowledgeEntries({ sort: "updated" });
    const entry = entries.find((e) => e.id === result.knowledgeEntryId);
    expect(entry).toBeTruthy();
    expect(entry?.status).toBe("draft");
    expect(entry?.created_by).toBe(USER);
    expect(entry?.content).toContain("Parsed content for First Doc");
    expect(entry?.source_type).toBe("Google Drive");
    expect((entry?.metadata as { oneTimeDriveIngest?: boolean }).oneTimeDriveIngest).toBe(true);
    expect((entry?.metadata as { googleManaged?: boolean }).googleManaged).toBe(false);

    // Not registered in recurring sync tables
    const roots = await import("@/lib/connectors/google/folders").then((m) =>
      m.listGoogleSyncFolders(),
    );
    const selections = await listSelectionsForRoot(roots[0]!.id);
    expect(selections).toHaveLength(0);
    const synced = await listSyncedFilesForRoot(roots[0]!.id);
    expect(synced).toHaveLength(0);
  });

  it("processes multiple files with per-file failure isolation", async () => {
    await ensureTestGoogleRootForIngest();
    const { jobId } = await enqueueUserDriveIngest({
      userId: USER,
      googleFileIds: ["doc-1", "doc-fail", "doc-2"],
    });

    const progress = await getDriveIngestProgress(jobId);
    expect(progress?.status).toBe("complete");
    expect(progress?.createdCount).toBe(2);
    expect(progress?.failedCount).toBe(1);
    expect(progress?.files.find((f) => f.googleFileId === "doc-fail")?.status).toBe("failed");
    expect(progress?.files.find((f) => f.googleFileId === "doc-1")?.status).toBe("complete");
    expect(progress?.files.find((f) => f.googleFileId === "doc-2")?.status).toBe("complete");

    const entries = await listKnowledgeEntries({ status: "draft" });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.created_by === USER)).toBe(true);

    const jobs = listMemoryJobsForTests().filter((j) => j.jobType === "knowledge_drive_ingest");
    expect(jobs.some((j) => j.id === jobId && j.status === "complete")).toBe(true);
  });

  it("lets an admin approve a Drive-ingested draft like a manual draft", async () => {
    await ensureTestGoogleRootForIngest();
    const { knowledgeEntryId } = await ingestOneDriveFileAsDraft({
      googleFileId: "doc-1",
      userId: USER,
      rootFolderId: "root-folder-1",
    });

    expect(
      canUserReadKnowledgeEntry(
        (await listKnowledgeEntries()).find((e) => e.id === knowledgeEntryId)!,
        USER,
        "user",
      ),
    ).toBe(true);

    const approved = await setKnowledgeEntryStatus(knowledgeEntryId, "approved", ADMIN);
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe(ADMIN);

    const visibleToOther = filterKnowledgeVisibleToUser(
      await listKnowledgeEntries(),
      "00000000-0000-4000-8000-0000000000bb",
      "user",
    );
    expect(visibleToOther.some((e) => e.id === knowledgeEntryId)).toBe(true);
  });

  it("does not create entries for unsupported mime types when called directly", async () => {
    await ensureTestGoogleRootForIngest();
    await expect(
      ingestOneDriveFileAsDraft({
        googleFileId: "unsupported-1",
        userId: USER,
        rootFolderId: "root-folder-1",
      }),
    ).rejects.toThrow(/not indexed|Video/i);
  });
});
