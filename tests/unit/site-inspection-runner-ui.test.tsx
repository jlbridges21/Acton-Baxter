/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InspectionsListClient } from "@/components/inspections/inspections-list-client";
import { InspectionsPageClient } from "@/components/inspections/inspections-page-client";
import { InspectionRunnerClient } from "@/components/inspections/inspection-runner-client";
import type { SiteInspectionDetail, SiteInspectionSummary } from "@/lib/inspections/record-types";
import { SITE_INSPECTION_VIEW_STORAGE_KEY } from "@/lib/inspections/view-preference";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/inspections/media-queue", () => ({
  VIDEO_WARN_MESSAGE:
    "Large videos can take a while to upload on cell signal. Keep the app open until the upload finishes.",
  VIDEO_MAX_BYTES: Number.POSITIVE_INFINITY,
  subscribeMediaQueue: (listener: (s: unknown) => void) => {
    listener({ pendingCount: 0, failedCount: 0, uploadingCount: 0, stalledCount: 0, items: [] });
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
  aiProcessingStatus: "idle",
  aiProcessingMessage: null,
  aiProcessingVideosTotal: 0,
  aiProcessingVideosDone: 0,
  aiProcessingSummariesTotal: 0,
  aiProcessingSummariesDone: 0,
  aiProcessingPhase: null,
  aiProcessingStartedAt: null,
  aiProcessingFinishedAt: null,
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
  itemSummaries: [],
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
    expect(screen.getByText("No cover photo yet")).toBeTruthy();
    expect(screen.queryByText(/Street View/)).toBeNull();
    expect(screen.getByText(/1 of 2 items/i)).toBeTruthy();
    expect(screen.getAllByText(/^Pending$/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Create New Site Inspection/i })).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.width).toBe("375px");
  });

  it("switches to a compact list and keeps that choice after remount", async () => {
    window.localStorage.clear();
    const props = {
      initialInspections: [summary],
      jobs: [],
      templates: [],
      assignees: [],
      currentUserId: "u1",
      isAdmin: false,
    };
    const first = render(<InspectionsPageClient {...props} />);
    const listButton = screen.getByRole("button", { name: "List view" });
    const gridButton = screen.getByRole("button", { name: "Grid view" });
    expect(gridButton.getAttribute("aria-pressed")).toBe("true");
    expect(gridButton.className).toContain("bg-[var(--acton-navy)]");
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(listButton);
    expect(listButton.getAttribute("aria-pressed")).toBe("true");
    expect(listButton.className).toContain("bg-[var(--acton-navy)]");
    expect(gridButton.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(window.localStorage.getItem(SITE_INSPECTION_VIEW_STORAGE_KEY)).toBe("list");
    first.unmount();

    render(<InspectionsPageClient {...props} />);
    await waitFor(() => {
      expect(screen.getByRole("table")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("shows compact list fields, a placeholder thumbnail, and the same filters as the grid", () => {
    const other: SiteInspectionSummary = {
      ...summary,
      id: "insp-2",
      projectName: "Other House",
      address: "9 Side St",
      status: "complete",
      assignedToName: "Alex",
      completedItemCount: 0,
      totalItemCount: 19,
      coverSignedUrl: "data:image/jpeg;base64,abc",
      coverSource: "photo",
    };
    const { rerender, container } = render(
      <div style={{ width: 375 }}>
        <InspectionsListClient
          initialInspections={[summary, other]}
          jobs={[]}
          templates={[]}
          assignees={[]}
          currentUserId="u1"
          isAdmin={false}
          view="grid"
        />
      </div>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search by project"), {
      target: { value: "Liniger" },
    });
    expect(screen.getByText("Liniger")).toBeTruthy();
    expect(screen.queryByText("Other House")).toBeNull();

    rerender(
      <div style={{ width: 375 }}>
        <InspectionsListClient
          initialInspections={[summary, other]}
          jobs={[]}
          templates={[]}
          assignees={[]}
          currentUserId="u1"
          isAdmin={false}
          view="list"
        />
      </div>,
    );
    expect(screen.queryByText("Other House")).toBeNull();
    expect(screen.getAllByText("No cover photo yet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("25 N Avalon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Pending$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 of 2 items/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Delete inspection Liniger" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Project" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Address" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Assigned to" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();

    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("hidden");
    expect(table.parentElement?.className).toContain("md:block");
    expect(table.className).not.toContain("min-w-");
    const mobile = screen.getByRole("list");
    expect(mobile.className).toContain("md:hidden");
    expect(container.innerHTML).not.toContain("overflow-x-auto");
    expect(container.innerHTML).not.toContain("min-w-[");

    fireEvent.change(screen.getByPlaceholderText("Search by project"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "complete" } });
    expect(screen.queryByText("Liniger")).toBeNull();
    expect(screen.getAllByText("Other House").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alex").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0 of 19 items/i).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("labels a Street View cover and hides the tag when a photo is the cover", () => {
    render(
      <InspectionsListClient
        initialInspections={[
          {
            ...summary,
            id: "insp-sv",
            projectName: "Street",
            coverSignedUrl: "data:image/jpeg;base64,abc",
            coverSource: "street_view",
            streetViewCapturedOn: "2024-06",
          },
          {
            ...summary,
            id: "insp-photo",
            projectName: "Photo",
            coverSignedUrl: "data:image/jpeg;base64,def",
            coverSource: "photo",
          },
        ]}
        jobs={[]}
        templates={[]}
        assignees={[]}
        currentUserId="u1"
        isAdmin={false}
      />,
    );
    expect(screen.getByText("Street View · 2024")).toBeTruthy();
    expect(screen.getAllByText("Street View · 2024")).toHaveLength(1);
    expect(screen.queryByText("No cover photo yet")).toBeNull();
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
    // Capture controls are labels wrapping opacity-0 file inputs (not <button>),
    // so Android honors `capture` on a genuine input activation.
    expect(screen.getAllByLabelText(/Take photo/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Take video/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Attach file/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Download all media/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Complete site inspection/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ACCESS/i }));
  });
});
