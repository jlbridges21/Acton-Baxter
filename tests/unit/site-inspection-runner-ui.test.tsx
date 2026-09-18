/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InspectionsListClient } from "@/components/inspections/inspections-list-client";
import { InspectionRunnerClient } from "@/components/inspections/inspection-runner-client";
import type { SiteInspectionDetail, SiteInspectionSummary } from "@/lib/inspections/record-types";

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
  purgeMediaQueueForInspection: vi.fn(async () => 0),
  purgeOrphanMediaQueueEntries: vi.fn(async () => 0),
  countPendingForInspection: vi.fn(async () => ({ pending: 0, failed: 0 })),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary: SiteInspectionSummary = {
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
};

const detail: SiteInspectionDetail = {
  ...summary,
  snapshot: {
    version: 1,
    sourceTemplateId: "t1",
    sourceTemplateName: "Detached ADU",
    snapshottedAt: "2026-01-01T00:00:00.000Z",
    standaloneItems: [
      {
        id: "cover-1",
        sourceTemplateItemId: "src-cover",
        title: "Front Photo of Main House",
        guideNotes: "• Capture front",
        allowsMedia: true,
        allowsNotes: true,
        isCoverPhotoSource: true,
        sortOrder: 0,
        subQuestions: [],
      },
    ],
    sections: [
      {
        id: "sec-1",
        sourceTemplateSectionId: "src-sec",
        title: "ACCESS",
        sortOrder: 0,
        items: [
          {
            id: "item-1",
            sourceTemplateItemId: "src-item",
            title: "Access",
            guideNotes: "• Route",
            allowsMedia: true,
            allowsNotes: true,
            isCoverPhotoSource: false,
            sortOrder: 0,
            subQuestions: [
              {
                id: "sq-1",
                prompt: "Sufficient access?",
                questionType: "yes_no_na",
                sortOrder: 0,
                options: [],
              },
            ],
          },
        ],
      },
    ],
  },
  responses: [
    {
      id: "r1",
      inspectionId: "insp-1",
      snapshotItemId: "item-1",
      isComplete: true,
      notes: "",
      answers: {},
      updatedBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  media: [],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ inspection: detail }),
    })),
  );
});

describe("Inspections UI at phone width", () => {
  it("renders cards with progress and pending tag", () => {
    const { container } = render(
      <div style={{ width: 375 }}>
        <InspectionsListClient
          initialInspections={[summary]}
          jobs={[]}
          templates={[
            {
              id: "t1",
              name: "Detached ADU",
              description: null,
              archivedAt: null,
              createdBy: null,
              updatedBy: null,
              createdAt: "",
              updatedAt: "",
              sectionCount: 1,
              itemCount: 2,
            },
          ]}
          assignees={[]}
          currentUserId="u1"
          isAdmin={false}
        />
      </div>,
    );
    expect(screen.getByText("Liniger")).toBeTruthy();
    expect(screen.getByText(/1 of 2 items/i)).toBeTruthy();
    expect(screen.getAllByText(/^Pending$/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Create New Site Inspection/i })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.width).toBe("375px");
  });

  it("runner shows internal guide notes, progress, photo/video attach, export, and complete", () => {
    render(
      <div style={{ width: 375 }}>
        <InspectionRunnerClient initialInspection={detail} currentUserId="u1" isAdmin={false} />
      </div>,
    );
    expect(screen.getByText(/1 of 2 complete/i)).toBeTruthy();
    expect(screen.getAllByText(/Internal only/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Mark Access complete/i)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Attach photo/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Attach video/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Download all media/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Complete site inspection/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ACCESS/i }));
  });
});
