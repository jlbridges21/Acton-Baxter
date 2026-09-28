/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InspectionsListClient } from "@/components/inspections/inspections-list-client";
import type { ExpenseJob } from "@/lib/receipts/types";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/inspections/media-queue", () => ({
  purgeMediaQueueForInspection: vi.fn(async () => 0),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = {
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
} as SiteInspectionSummary;

const job: ExpenseJob = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "L01-26019 Liniger — 25 N Avalon Dr, Los Altos",
  projectNumber: "L01-26019",
  source: "project",
  isActive: true,
  sortOrder: 0,
  createdBy: null,
  updatedBy: null,
  createdAt: "",
  updatedAt: "",
};

const selected = {
  placeId: "place-1",
  formattedAddress: "15170 Woodard Rd, San Jose, CA 95124, USA",
  addressLine1: "15170 Woodard Rd",
  city: "San Jose",
  state: "CA",
  zipCode: "95124",
  county: "Santa Clara County",
  country: "US",
  latitude: 37.257,
  longitude: -121.905,
};

function renderForm() {
  return render(
    <InspectionsListClient
      initialInspections={[summary]}
      jobs={[job]}
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
    />,
  );
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

describe("inspection address autocomplete", () => {
  it("selects a Places suggestion and submits the normalized address with coordinates", async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/api/address/autocomplete")) {
          const query = new URL(href, "http://localhost").searchParams.get("query") ?? "";
          if (query.toLowerCase().includes("woodard")) {
            return jsonResponse({
              suggestions: [
                {
                  placeId: "place-1",
                  description: "15170 Woodard Rd, San Jose, CA",
                  mainText: "15170 Woodard Rd",
                  secondaryText: "San Jose, CA",
                },
              ],
            });
          }
          return jsonResponse({ suggestions: [] });
        }
        if (href.includes("/api/address/place/")) {
          return jsonResponse({ address: selected });
        }
        if (href.includes("/api/inspections") && init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return jsonResponse({ inspection: { id: "insp-new" } });
        }
        return jsonResponse({});
      }),
    );

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Create New Site Inspection/i }));
    fireEvent.focus(screen.getByPlaceholderText(/Search projects/i));
    fireEvent.click(screen.getByRole("button", { name: job.label }));

    const address = screen.getByLabelText(/^Address/i) as HTMLInputElement;
    expect(address.value).toBe("25 N Avalon Dr, Los Altos");

    fireEvent.change(address, { target: { value: "15170 woodard" } });
    await waitFor(() => {
      expect(screen.getByText("15170 Woodard Rd")).toBeTruthy();
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: /15170 Woodard Rd/i }));
    await waitFor(() => {
      expect(address.value).toBe(selected.formattedAddress);
    });

    fireEvent.click(screen.getByRole("button", { name: /Create & open checklist/i }));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]).toMatchObject({
      address: selected.formattedAddress,
      latitude: 37.257,
      longitude: -121.905,
      projectName: "L01-26019 Liniger",
    });
  });

  it("submits a typed address when Places has no match", async () => {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/api/address/autocomplete")) {
          return jsonResponse({ suggestions: [] });
        }
        if (href.includes("/api/inspections") && init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return jsonResponse({ inspection: { id: "insp-typed" } });
        }
        return jsonResponse({});
      }),
    );

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Create New Site Inspection/i }));
    fireEvent.change(screen.getByLabelText(/Project name/i), {
      target: { value: "New parcel" },
    });
    fireEvent.change(screen.getByLabelText(/^Address/i), {
      target: { value: "Lot 4, unnamed ranch road" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create & open checklist/i }));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]).toMatchObject({
      projectName: "New parcel",
      address: "Lot 4, unnamed ranch road",
    });
    expect(posts[0]?.latitude).toBeUndefined();
    expect(posts[0]?.longitude).toBeUndefined();
  });
});
