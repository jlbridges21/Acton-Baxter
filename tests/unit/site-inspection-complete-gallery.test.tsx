/**
 * @vitest-environment jsdom
 *
 * Complete-site-inspection flow + media gallery affordances.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InspectionRunnerClient } from "@/components/inspections/inspection-runner-client";
import { InspectionMediaGallery } from "@/components/inspections/inspection-media-gallery";
import type { SiteInspectionDetail, SiteInspectionMedia } from "@/lib/inspections/record-types";
import {
  createSiteInspection,
  createTemplateFromSeed,
  DETACHED_ADU_SEED,
  prepareSiteInspectionMedia,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  setSiteInspectionProfileNameForTests,
  setSiteInspectionStatus,
  completeSiteInspectionMedia,
  updateSiteInspectionMediaStatus,
} from "@/lib/inspections";
import { resetEnvCacheForTests } from "@/lib/env";

const countPending = vi.fn(async (): Promise<{ pending: number; failed: number }> => ({
  pending: 0,
  failed: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/inspections/media-queue", () => ({
  VIDEO_WARN_MESSAGE: "Keep videos under 2 minutes and about 100 MB.",
  VIDEO_MAX_BYTES: 100 * 1024 * 1024,
  subscribeMediaQueue: (listener: (s: unknown) => void) => {
    listener({ pendingCount: 0, failedCount: 0, uploadingCount: 0, items: [] });
    return () => undefined;
  },
  startMediaQueueDrain: () => () => undefined,
  enqueueInspectionMedia: vi.fn(),
  retryMediaUpload: vi.fn(),
  discardMediaUpload: vi.fn(),
  cancelAndDiscardMediaUpload: vi.fn(),
  countPendingForInspection: () => countPending(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  countPending.mockReset();
  countPending.mockResolvedValue({ pending: 0, failed: 0 });
});

const detail: SiteInspectionDetail = {
  id: "insp-1",
  projectName: "Liniger",
  address: "25 N Avalon",
  jobId: null,
  assignedTo: null,
  assignedToName: null,
  sourceTemplateId: "t1",
  status: "pending",
  coverMediaId: null,
  coverSignedUrl: null,
  totalItemCount: 2,
  completedItemCount: 1,
  pendingMediaCount: 0,
  failedMediaCount: 0,
  createdBy: "u1",
  createdByName: "Tech",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  snapshot: {
    version: 1,
    sourceTemplateId: "t1",
    sourceTemplateName: "Detached ADU",
    snapshottedAt: "2026-01-01T00:00:00.000Z",
    standaloneItems: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        sourceTemplateItemId: "src-cover",
        title: "Cover",
        guideNotes: "Capture front",
        allowsMedia: true,
        allowsNotes: true,
        isCoverPhotoSource: true,
        sortOrder: 0,
        subQuestions: [],
      },
    ],
    sections: [
      {
        id: "s1",
        sourceTemplateSectionId: "src-sec",
        title: "ACCESS",
        sortOrder: 0,
        items: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            sourceTemplateItemId: "src-item",
            title: "Access",
            guideNotes: "Internal note",
            allowsMedia: true,
            allowsNotes: true,
            isCoverPhotoSource: false,
            sortOrder: 0,
            subQuestions: [],
          },
        ],
      },
    ],
  },
  responses: [
    {
      id: "r1",
      inspectionId: "insp-1",
      snapshotItemId: "22222222-2222-4222-8222-222222222222",
      isComplete: true,
      notes: "",
      answers: {},
      updatedBy: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  media: [],
};

describe("complete site inspection UI", () => {
  it("shows complete button and does not auto-flip status from last checkbox in source", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-runner-client.tsx"),
      "utf8",
    );
    expect(source).toContain("Complete site inspection");
    expect(source).toContain("Reopen inspection");
    expect(source).toContain("never auto-derived from checkboxes");
    expect(source).not.toMatch(/completed >= prev\.totalItemCount \? "complete"/);
  });

  it("blocks complete when uploads failed", async () => {
    countPending.mockResolvedValue({ pending: 0, failed: 3 });
    render(
      <div style={{ width: 375 }}>
        <InspectionRunnerClient initialInspection={detail} currentUserId="u1" isAdmin={false} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Complete site inspection/i }));
    await waitFor(() => {
      expect(screen.getByText(/3 uploads failed/i)).toBeTruthy();
    });
  });

  it("offers to wait when uploads are pending", async () => {
    countPending.mockResolvedValue({ pending: 2, failed: 0 });
    render(
      <InspectionRunnerClient initialInspection={detail} currentUserId="u1" isAdmin={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Complete site inspection/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Uploads still pending/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Wait for uploads/i })).toBeTruthy();
    });
  });

  it("warns with unchecked count and allows proceed", async () => {
    countPending.mockResolvedValue({ pending: 0, failed: 0 });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        inspection: { ...detail, status: "complete" as const },
      }),
      body: init?.body,
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InspectionRunnerClient initialInspection={detail} currentUserId="u1" isAdmin={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Complete site inspection/i }));
    await waitFor(() => {
      expect(screen.getByText(/1 item is not checked/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Complete anyway/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const statusCall = fetchMock.mock.calls.find((call) => {
        const body = call[1]?.body;
        return typeof body === "string" && body.includes('"status"');
      });
      expect(statusCall).toBeTruthy();
      expect(JSON.parse(statusCall![1]!.body as string)).toEqual({ status: "complete" });
      expect(screen.getByRole("heading", { name: /Inspection complete/i })).toBeTruthy();
    });
  });
});

describe("status store — explicit complete only", () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    resetEnvCacheForTests();
    resetInspectionTemplateMemoryForTests();
    resetSiteInspectionMemoryForTests();
    resetSiteInspectionMediaMemoryForTests();
    setSiteInspectionProfileNameForTests("user-1", "Field Tech");
  });

  it("refuses complete while media is pending, then allows after ready + reopen", async () => {
    const template = await createTemplateFromSeed(DETACHED_ADU_SEED, "user-1");
    const inspection = await createSiteInspection({
      projectName: "Liniger",
      address: "25 N Avalon",
      templateId: template.id,
      createdBy: "user-1",
    });
    const item = inspection.snapshot.standaloneItems[0]!;
    const clientMediaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await prepareSiteInspectionMedia({
      inspectionId: inspection.id,
      snapshotItemId: item.id,
      clientMediaId,
      mediaType: "photo",
      mimeType: "image/jpeg",
      byteSize: 12,
      actorId: "user-1",
    });

    await expect(
      setSiteInspectionStatus({
        inspectionId: inspection.id,
        status: "complete",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/pending/i);

    await updateSiteInspectionMediaStatus({
      inspectionId: inspection.id,
      clientMediaId,
      uploadStatus: "failed",
    });
    await expect(
      setSiteInspectionStatus({
        inspectionId: inspection.id,
        status: "complete",
        actorId: "user-1",
      }),
    ).rejects.toThrow(/failed/i);

    await completeSiteInspectionMedia({
      inspectionId: inspection.id,
      clientMediaId,
      storagePath: `memory/${clientMediaId}.jpg`,
      byteSize: 12,
      actorId: "user-1",
    });

    const done = await setSiteInspectionStatus({
      inspectionId: inspection.id,
      status: "complete",
      actorId: "user-1",
    });
    expect(done.status).toBe("complete");

    const reopened = await setSiteInspectionStatus({
      inspectionId: inspection.id,
      status: "pending",
      actorId: "user-1",
    });
    expect(reopened.status).toBe("pending");
  });
});

describe("media gallery", () => {
  const sampleMedia: SiteInspectionMedia[] = [
    {
      id: "m1",
      inspectionId: "insp-1",
      snapshotItemId: "item-1",
      clientMediaId: "c1",
      storagePath: "path/a.jpg",
      mediaType: "photo",
      sortOrder: 0,
      uploadStatus: "ready",
      uploadProgress: 1,
      mimeType: "image/jpeg",
      byteSize: 10,
      createdBy: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      signedUrl: "https://example.com/a.jpg",
      localPreviewUrl: null,
    },
    {
      id: "m2",
      inspectionId: "insp-1",
      snapshotItemId: "item-1",
      clientMediaId: "c2",
      storagePath: "path/b.mp4",
      mediaType: "video",
      sortOrder: 1,
      uploadStatus: "ready",
      uploadProgress: 1,
      mimeType: "video/mp4",
      byteSize: 20,
      createdBy: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      signedUrl: "https://example.com/b.mp4",
      localPreviewUrl: null,
    },
  ];

  it("opens with position indicator, navigates, and batches signed URL refresh", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        urls: { m1: "https://example.com/a2.jpg", m2: "https://example.com/b2.mp4" },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        expiresInSeconds: 600,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <div style={{ width: 375 }}>
        <InspectionMediaGallery
          open
          onClose={() => undefined}
          inspectionId="insp-1"
          snapshotItemId="item-1"
          itemTitle="Panel"
          media={sampleMedia}
          initialIndex={0}
        />
      </div>,
    );

    expect(screen.getByText(/1 of 2/)).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/media/signed-urls?snapshotItemId=item-1"),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Next media/i }));
    expect(screen.getByText(/2 of 2/)).toBeTruthy();
    expect(document.querySelector("video")).toBeTruthy();

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(screen.getByText(/1 of 2/)).toBeTruthy();
    });
  });

  it("gallery source uses Dialog and batch signed-urls endpoint", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/inspections/inspection-media-gallery.tsx"),
      "utf8",
    );
    expect(source).toContain("Dialog");
    expect(source).toContain("signed-urls");
    expect(source).toContain("ArrowLeft");
    expect(source).toContain("onTouchEnd");
    expect(source).toContain("playsInline");
    expect(source).toContain("onRequestDelete");
    expect(source).toContain("Delete media");
  });
});
