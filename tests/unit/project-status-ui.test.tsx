/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EditInspectionDialog } from "@/components/inspections/edit-inspection-dialog";
import { MasterProjectLogClient } from "@/components/admin/master-project-log-client";
import type { ProjectLogRow } from "@/lib/baxter-data/project-registry";
import type { SiteInspectionSummary } from "@/lib/inspections/record-types";
import type { ExpenseJob } from "@/lib/receipts/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => cleanup());

const OPEN_JOB: ExpenseJob = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "L01-26019 Liniger — 25 N Avalon Dr, Los Altos",
  projectNumber: "L01-26019",
  source: "project",
  projectStatus: "open",
  isActive: true,
  sortOrder: 0,
  createdBy: null,
  updatedBy: null,
  createdAt: "",
  updatedAt: "",
};

const CLOSED_JOB_ID = "22222222-2222-4222-8222-222222222222";

describe("EditInspectionDialog with a Closed project", () => {
  it("shows the current Closed link but only offers Open projects", () => {
    const row = {
      id: "insp-1",
      projectName: "Oldjob",
      address: "1 Old St, San Jose",
      jobId: CLOSED_JOB_ID,
      assignedTo: null,
    } as SiteInspectionSummary;
    render(
      <EditInspectionDialog
        row={row}
        jobs={[OPEN_JOB]}
        linkedJobLabels={{ [CLOSED_JOB_ID]: "L01-25001 Oldjob — 1 Old St, San Jose (Closed)" }}
        assignees={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("current-linked-project").textContent).toBe(
      "Current: L01-25001 Oldjob — 1 Old St, San Jose (Closed)",
    );
    fireEvent.focus(screen.getByPlaceholderText("Search projects or type a name"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([OPEN_JOB.label]);
  });
});

function logRow(
  projectNumber: string,
  shortName: string,
  status: ProjectLogRow["status"],
): ProjectLogRow {
  return {
    projectNumber,
    shortName,
    salesperson: "Jenn Lee",
    startDate: "3/1/2026",
    customerName: `${shortName} Customer`,
    street: "1 Main St",
    city: "San Jose",
    postalCode: "95110",
    jurisdiction: "San Jose",
    status,
    rowNumber: 7,
  };
}

describe("MasterProjectLogClient", () => {
  const rows = [
    logRow("L01-26001", "Zeta", "open"),
    logRow("L01-26002", "Alpha", "open"),
    logRow("L01-26003", "Closedone", "closed"),
    logRow("L01-26004", "Nostatus", "unknown"),
  ];

  function renderLog(overrides: Partial<Parameters<typeof MasterProjectLogClient>[0]> = {}) {
    return render(
      <MasterProjectLogClient
        rows={rows}
        spreadsheetId="sheet-123"
        tabName="Master Project Log"
        fetchedAt="2026-10-20T16:00:00.000Z"
        fromCache
        loadError={null}
        initialView={{ status: "open", sort: "name-asc", q: "" }}
        {...overrides}
      />,
    );
  }

  function visibleNumbers(): string[] {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((tr) => tr.querySelector("td")?.textContent ?? "");
  }

  it("defaults to Open sorted A→Z, counts each status, and warns about Unknown rows", () => {
    renderLog();
    expect(visibleNumbers()).toEqual(["L01-26002", "L01-26001"]);
    expect(screen.getByRole("button", { name: "Open 2" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "All 4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Closed 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unknown 1" })).toBeTruthy();
    expect(screen.getByTestId("project-log-unknown-warning").textContent).toBe(
      "1 project has no Open/Closed status in column J and is hidden from tools.",
    );
    expect(screen.getByTestId("project-log-fetched").textContent).toMatch(/cached copy/);
    expect(screen.getByRole("link", { name: "Open sheet" }).getAttribute("href")).toBe(
      "https://docs.google.com/spreadsheets/d/sheet-123/edit",
    );
  });

  it("filters, searches, sorts, and keeps the view in the URL", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "All 4" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort projects" }), {
      target: { value: "number-desc" },
    });
    expect(visibleNumbers()).toEqual(["L01-26004", "L01-26003", "L01-26002", "L01-26001"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "closedone" },
    });
    expect(visibleNumbers()).toEqual(["L01-26003"]);
    expect(window.location.search).toBe("?status=all&sort=number-desc&q=closedone");
  });

  it("explains how to configure the sheet when Project Setup has no sheet", () => {
    renderLog({ rows: [], spreadsheetId: "", tabName: "", fetchedAt: null });
    expect(screen.getByText(/isn.t set up yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Project Setup Settings" }).getAttribute("href")).toBe(
      "/admin/project-setup",
    );
  });
});
