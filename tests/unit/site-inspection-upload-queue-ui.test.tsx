/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InspectionUploadQueueBar } from "@/components/inspections/inspection-upload-queue-bar";
import { InspectionRunnerClient } from "@/components/inspections/inspection-runner-client";
import {
  buildQueuedMediaDeviceFilename,
  formatInspectionMediaFailure,
  formatInspectionMediaStepLabel,
} from "@/lib/inspections/media-limits";
import { findSnapshotMediaStep } from "@/lib/inspections/snapshot";
import type { MediaQueueItemSnapshot } from "@/lib/inspections/media-queue";
import type { InspectionSnapshot } from "@/lib/inspections/snapshot";
import type { SiteInspectionDetail } from "@/lib/inspections/record-types";

const queueHold = vi.hoisted(() => ({
  items: [] as MediaQueueItemSnapshot[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/inspections/media-queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inspections/media-queue")>(
    "@/lib/inspections/media-queue",
  );
  return {
    ...actual,
    subscribeMediaQueue: (
      listener: (snap: {
        pendingCount: number;
        failedCount: number;
        uploadingCount: number;
        stalledCount: number;
        items: MediaQueueItemSnapshot[];
      }) => void,
    ) => {
      const items = queueHold.items;
      listener({
        pendingCount: items.filter((item) => item.status !== "failed").length,
        failedCount: items.filter((item) => item.status === "failed").length,
        uploadingCount: items.filter((item) => item.status === "uploading").length,
        stalledCount: items.filter((item) => item.isStalled).length,
        items,
      });
      return () => undefined;
    },
    startMediaQueueDrain: () => () => undefined,
    enqueueInspectionMedia: vi.fn(),
    retryMediaUpload: vi.fn(),
    retryAllMediaUploads: vi.fn(async () => 0),
    listQueuedMediaForDeviceExport: vi.fn(async () => []),
    discardMediaUpload: vi.fn(),
    cancelAndDiscardMediaUpload: vi.fn(),
    purgeMediaQueueForInspection: vi.fn(async () => 0),
    purgeOrphanMediaQueueEntries: vi.fn(async () => 0),
    countPendingForInspection: vi.fn(async () => ({ pending: 0, failed: 0 })),
  };
});

function queueItem(
  overrides: Partial<MediaQueueItemSnapshot> & Pick<MediaQueueItemSnapshot, "clientMediaId">,
): MediaQueueItemSnapshot {
  return {
    inspectionId: "insp-1",
    snapshotItemId: "item-access",
    mediaType: "photo",
    status: "uploading",
    progress: 0.4,
    lastError: null,
    attempts: 0,
    nextAttemptAt: 0,
    lastProgressAt: 1,
    createdAt: 1,
    byteSize: 1000,
    statusReason: "Uploading 40%",
    isStalled: false,
    ...overrides,
  };
}

const snapshot: InspectionSnapshot = {
  version: 1,
  sourceTemplateId: "t1",
  sourceTemplateName: "Detached ADU",
  snapshottedAt: "2026-01-01T00:00:00.000Z",
  standaloneItems: [],
  sections: [
    {
      id: "sec-1",
      sourceTemplateSectionId: "src",
      title: "SITE",
      sortOrder: 0,
      items: [
        {
          id: "item-access",
          sourceTemplateItemId: "src-access",
          title: "Access",
          guideNotes: "",
          allowsMedia: true,
          allowsNotes: true,
          isCoverPhotoSource: false,
          sortOrder: 0,
          subQuestions: [
            {
              id: "sq-access",
              prompt: "Sufficient access?",
              questionType: "yes_no_na",
              sortOrder: 0,
              options: [],
            },
          ],
        },
        {
          id: "item-hardscape",
          sourceTemplateItemId: "src-hard",
          title: "Landscape & Hardscape",
          guideNotes: "",
          allowsMedia: true,
          allowsNotes: true,
          isCoverPhotoSource: false,
          sortOrder: 1,
          subQuestions: [],
        },
      ],
    },
  ],
};

function labelFor(item: MediaQueueItemSnapshot): string {
  const step = findSnapshotMediaStep(snapshot, item.snapshotItemId);
  return formatInspectionMediaStepLabel({
    stepTitle: step.stepTitle,
    subQuestionPrompt: step.subQuestionPrompt,
    mediaType: item.mediaType,
  });
}

function renderBar(items: MediaQueueItemSnapshot[]) {
  const onRetryAll = vi.fn();
  const view = render(
    <div style={{ width: 375 }}>
      <InspectionUploadQueueBar
        items={items}
        labelFor={labelFor}
        retryAllBusy={false}
        saveQueuedBusy={false}
        retryAllLabel="Retry all uploads"
        saveLabel="Save queued media to device"
        onRetryAll={onRetryAll}
        onSaveToDevice={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />
      <button type="button">Next checklist item</button>
    </div>,
  );
  return { ...view, onRetryAll };
}

beforeEach(() => {
  queueHold.items = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ inspection: null }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("upload step labels and export names", () => {
  it("names the checklist step, and the sub-question when media is on one", () => {
    expect(formatInspectionMediaStepLabel({ stepTitle: "Access", mediaType: "photo" })).toBe(
      "Access — photo",
    );
    expect(
      formatInspectionMediaStepLabel({
        stepTitle: "Landscape & Hardscape",
        mediaType: "video",
      }),
    ).toBe("Landscape & Hardscape — video");
    const sub = findSnapshotMediaStep(snapshot, "sq-access");
    expect(
      formatInspectionMediaStepLabel({
        stepTitle: sub.stepTitle,
        subQuestionPrompt: sub.subQuestionPrompt,
        mediaType: "photo",
      }),
    ).toBe("Access — Sufficient access? — photo");
    expect(formatInspectionMediaFailure("Access — photo", "Signed upload failed")).toBe(
      "Access — photo failed — Signed upload failed",
    );
    expect(
      buildQueuedMediaDeviceFilename({
        stepTitle: "Landscape & Hardscape",
        mediaType: "video",
        ext: "mp4",
        index: 1,
        total: 1,
      }),
    ).toBe("Landscape_Hardscape__video.mp4");
    expect(
      buildQueuedMediaDeviceFilename({
        stepTitle: "Access",
        subQuestionPrompt: "Sufficient access?",
        mediaType: "photo",
        ext: "jpg",
        index: 2,
        total: 2,
      }),
    ).toBe("Access__Sufficient_access__photo_02.jpg");
  });
});

describe("collapsed upload indicator", () => {
  const items = [
    queueItem({
      clientMediaId: "photo-1",
      snapshotItemId: "item-access",
      progress: 0.5,
      byteSize: 100,
    }),
    queueItem({
      clientMediaId: "video-1",
      snapshotItemId: "item-hardscape",
      mediaType: "video",
      status: "finalizing",
      progress: 1,
      statusReason: "Finalizing on server…",
      byteSize: 300,
    }),
    queueItem({
      clientMediaId: "photo-2",
      snapshotItemId: "item-access",
      status: "queued",
      progress: 0,
      statusReason: "Queued — waiting for an upload slot",
    }),
    queueItem({
      clientMediaId: "photo-3",
      snapshotItemId: "sq-access",
      status: "failed",
      progress: 0,
      statusReason: "Signed upload failed",
      lastError: "Signed upload failed",
    }),
  ];

  it("stays one line, expands to a scrolling list, and leaves the next item usable", () => {
    renderBar(items);
    const summary = screen.getByTestId("upload-queue-summary");
    expect(summary.textContent).toContain("1 uploading");
    expect(summary.textContent).toContain("1 finalizing");
    expect(summary.textContent).toContain("1 queued");
    expect(summary.textContent).toContain("1 failed");
    expect(summary.className).toContain("min-h-11");
    expect(summary.parentElement?.className).toContain("flex-nowrap");
    expect(screen.queryByTestId("upload-queue-list")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry all uploads" })).toBeTruthy();

    const next = screen.getByRole("button", { name: "Next checklist item" });
    expect(summary.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(next);

    fireEvent.click(summary);
    const list = screen.getByTestId("upload-queue-list");
    expect(list.className).toContain("max-h-36");
    expect(list.className).toContain("overflow-y-auto");
    expect(screen.getAllByText("Access — photo")).toHaveLength(2);
    expect(screen.getByText("Landscape & Hardscape — video")).toBeTruthy();
    expect(screen.getByText("Finalizing on server…")).toBeTruthy();
    expect(
      screen.getByText("Access — Sufficient access? — photo failed — Signed upload failed"),
    ).toBeTruthy();

    fireEvent.click(summary);
    expect(screen.queryByTestId("upload-queue-list")).toBeNull();
    expect(screen.getByRole("button", { name: "Next checklist item" })).toBeTruthy();
  });

  it("keeps Retry all on a stalled queue without expanding", () => {
    const { onRetryAll } = renderBar([
      queueItem({
        clientMediaId: "stuck",
        status: "uploading",
        progress: 0.2,
        statusReason: "Upload stalled at 20% — nothing moved for several minutes",
        isStalled: true,
      }),
    ]);
    expect(screen.getByTestId("upload-queue-summary").textContent).toContain("1 stalled");
    expect(screen.queryByTestId("upload-queue-list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry all uploads" }));
    expect(onRetryAll).toHaveBeenCalledOnce();
  });

  it("remembers expanded within the session, then collapses and fades when the queue clears", async () => {
    vi.useFakeTimers();
    const { rerender } = renderBar(items.slice(0, 2));
    fireEvent.click(screen.getByTestId("upload-queue-summary"));
    expect(screen.getByTestId("upload-queue-list")).toBeTruthy();

    rerender(
      <div style={{ width: 375 }}>
        <InspectionUploadQueueBar
          items={items.slice(0, 2)}
          labelFor={labelFor}
          retryAllBusy={false}
          saveQueuedBusy={false}
          retryAllLabel="Retry all uploads"
          saveLabel="Save queued media to device"
          onRetryAll={vi.fn()}
          onSaveToDevice={vi.fn()}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
        />
      </div>,
    );
    expect(screen.getByTestId("upload-queue-list")).toBeTruthy();

    rerender(
      <div style={{ width: 375 }}>
        <InspectionUploadQueueBar
          items={[]}
          labelFor={labelFor}
          retryAllBusy={false}
          saveQueuedBusy={false}
          retryAllLabel="Retry all uploads"
          saveLabel="Save queued media to device"
          onRetryAll={vi.fn()}
          onSaveToDevice={vi.fn()}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
        />
      </div>,
    );
    expect(screen.queryByTestId("upload-queue-list")).toBeNull();
    expect(screen.getByTestId("upload-queue-done").textContent).toContain("Uploads finished");
    await act(async () => {
      vi.advanceTimersByTime(2800);
    });
    expect(screen.queryByTestId("upload-queue-done")).toBeNull();
  });

  it("keeps failures visible after other uploads finish", () => {
    const { rerender } = renderBar(items);
    rerender(
      <div style={{ width: 375 }}>
        <InspectionUploadQueueBar
          items={[items[3]!]}
          labelFor={labelFor}
          retryAllBusy={false}
          saveQueuedBusy={false}
          retryAllLabel="Retry all uploads"
          saveLabel="Save queued media to device"
          onRetryAll={vi.fn()}
          onSaveToDevice={vi.fn()}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
        />
      </div>,
    );
    expect(screen.queryByTestId("upload-queue-done")).toBeNull();
    expect(screen.getByTestId("upload-queue-summary").textContent).toContain("1 failed");
    fireEvent.click(screen.getByTestId("upload-queue-summary"));
    expect(screen.getByText(/Access — Sufficient access\? — photo failed/)).toBeTruthy();
  });
});

describe("checklist stays usable under a full queue", () => {
  it("shows the collapsed indicator inside the sticky header and still toggles the next item", () => {
    queueHold.items = [
      queueItem({ clientMediaId: "photo-1", snapshotItemId: "item-access" }),
      queueItem({
        clientMediaId: "video-1",
        snapshotItemId: "item-hardscape",
        mediaType: "video",
        status: "uploading",
        progress: 0.1,
        statusReason: "Uploading 10%",
        byteSize: 5_000_000,
      }),
      queueItem({
        clientMediaId: "photo-2",
        snapshotItemId: "item-access",
        status: "queued",
        progress: 0,
        statusReason: "Queued — waiting for an upload slot",
      }),
    ];
    const detail = {
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
      completedItemCount: 0,
      pendingMediaCount: 3,
      failedMediaCount: 0,
      createdBy: "u1",
      createdByName: "Tech",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      aiProcessingStatus: "idle",
      aiProcessingMessage: null,
      aiProcessingVideosTotal: 0,
      aiProcessingVideosDone: 0,
      aiProcessingSummariesTotal: 0,
      aiProcessingSummariesDone: 0,
      aiProcessingPhase: null,
      aiProcessingStartedAt: null,
      aiProcessingFinishedAt: null,
      snapshot,
      responses: [],
      media: [],
      itemSummaries: [],
    } as SiteInspectionDetail;

    render(
      <div style={{ width: 375 }}>
        <InspectionRunnerClient initialInspection={detail} currentUserId="u1" isAdmin={false} />
      </div>,
    );

    const summary = screen.getByTestId("upload-queue-summary");
    expect(summary.closest("[class*='sticky']")).toBeTruthy();
    expect(summary.className).not.toContain("fixed");
    expect(summary.parentElement?.className).not.toContain("fixed");
    expect(screen.queryByTestId("upload-queue-list")).toBeNull();

    const access = screen.getByLabelText("Mark Access complete") as HTMLInputElement;
    const hardscape = screen.getByLabelText(
      "Mark Landscape & Hardscape complete",
    ) as HTMLInputElement;
    expect(
      summary.compareDocumentPosition(hardscape) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(access.checked).toBe(false);
    fireEvent.click(access);
    expect(access.checked).toBe(true);
    fireEvent.click(hardscape);
    expect(hardscape.checked).toBe(true);
  });
});
