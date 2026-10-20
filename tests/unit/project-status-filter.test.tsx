/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  ProjectStatusFilter,
  projectStatusFilterStorageKey,
  resetProjectStatusViewsForTests,
  useProjectStatusView,
} from "@/components/shared/project-status-filter";
import { ProjectSyncStatus } from "@/components/admin/project-sync-status";
import { InspectionProjectPicker } from "@/components/inspections/inspection-project-picker";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { ReceiptLogClient } from "@/components/receipts/receipt-log-client";
import { ReceiptLogFiltersPanel } from "@/components/receipts/receipt-log-filters-panel";
import { emptyInventoryFilters } from "@/lib/inventory/filters";
import type { InventoryItem, InventoryVocabValue } from "@/lib/inventory/types";
import { parseReceiptLogFiltersFromParams } from "@/lib/receipts/log-filter-url";
import {
  countProjectStatusViews,
  filterByProjectStatusView,
  projectStatusNoMatchMessage,
} from "@/lib/receipts/project-status-view";
import { summarizeProjectJobSync } from "@/lib/receipts/project-sync-summary";
import type { ExpenseJob } from "@/lib/receipts/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  resetProjectStatusViewsForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function job(id: string, label: string, overrides: Partial<ExpenseJob> = {}): ExpenseJob {
  return {
    id,
    label,
    projectNumber: null,
    source: "project",
    projectStatus: "open",
    isActive: true,
    sortOrder: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const OPEN = job("open-1", "L01-26019 Liniger ADU");
const CLOSED_A = job("closed-1", "L01-25001 Smith ADU", { projectStatus: "closed" });
const CLOSED_B = job("closed-2", "L01-25002 Smithson Garage", { projectStatus: "closed" });
const CUSTOM = job("custom-1", "Office supplies", { source: "custom", projectStatus: "unknown" });
const JOBS = [OPEN, CLOSED_A, CLOSED_B, CUSTOM];

describe("project status view helpers", () => {
  it("counts custom jobs in every view and lists Open before Closed in All", () => {
    expect(countProjectStatusViews(JOBS)).toEqual({ open: 2, closed: 3, all: 4 });
    const all = filterByProjectStatusView([CLOSED_A, OPEN, CLOSED_B, CUSTOM], "all");
    expect(all.map((j) => j.id)).toEqual(["open-1", "custom-1", "closed-1", "closed-2"]);
    expect(filterByProjectStatusView(JOBS, "closed").map((j) => j.id)).toEqual([
      "custom-1",
      "closed-1",
      "closed-2",
    ]);
  });

  it("keeps pinned ids visible in any view", () => {
    const visible = filterByProjectStatusView(JOBS, "open", {
      getId: (j) => j.id,
      pinnedIds: ["closed-2"],
    });
    expect(visible.map((j) => j.id)).toEqual(["open-1", "custom-1", "closed-2"]);
  });

  it("words the no-match hint", () => {
    expect(projectStatusNoMatchMessage({ view: "open", query: "smith", hiddenCount: 2 })).toBe(
      "No Open projects match “smith”. 2 Closed projects match",
    );
    expect(projectStatusNoMatchMessage({ view: "closed", query: "x", hiddenCount: 1 })).toBe(
      "No Closed projects match “x”. 1 Open project matches",
    );
  });
});

function Harness({ tool }: { tool: "receipts" | "inventory" }) {
  const [view, setView] = useProjectStatusView(tool);
  const options = filterByProjectStatusView(JOBS, view);
  return (
    <div>
      <ProjectStatusFilter value={view} onChange={setView} counts={countProjectStatusViews(JOBS)} />
      <ul aria-label="options">
        {options.map((j) => (
          <li key={j.id}>{j.label}</li>
        ))}
      </ul>
    </div>
  );
}

function optionLabels() {
  return within(screen.getByRole("list", { name: "options" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("ProjectStatusFilter", () => {
  it("defaults to Open, shows counts, and switching changes the options", () => {
    render(<Harness tool="receipts" />);
    const group = screen.getByRole("radiogroup", { name: "Show projects" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Open 2", "Closed 3", "All 4"]);
    expect(screen.getByRole("radio", { name: "Open 2" }).getAttribute("aria-checked")).toBe("true");
    expect(optionLabels()).toEqual(["L01-26019 Liniger ADU", "Office supplies"]);

    fireEvent.click(screen.getByRole("radio", { name: "Closed 3" }));
    expect(optionLabels()).toEqual([
      "Office supplies",
      "L01-25001 Smith ADU",
      "L01-25002 Smithson Garage",
    ]);
  });

  it("is keyboard operable with arrow keys", () => {
    render(<Harness tool="receipts" />);
    const open = screen.getByRole("radio", { name: "Open 2" });
    expect(open.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(open, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Closed 3" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Closed 3" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Open 2" }), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "All 4" }).getAttribute("aria-checked")).toBe("true");
  });

  it("remembers the view per tool in localStorage", () => {
    const { unmount } = render(<Harness tool="inventory" />);
    fireEvent.click(screen.getByRole("radio", { name: "All 4" }));
    expect(localStorage.getItem(projectStatusFilterStorageKey("inventory"))).toBe("all");
    expect(localStorage.getItem(projectStatusFilterStorageKey("receipts"))).toBeNull();
    unmount();

    resetProjectStatusViewsForTests();
    render(<Harness tool="inventory" />);
    expect(screen.getByRole("radio", { name: "All 4" }).getAttribute("aria-checked")).toBe("true");
    cleanup();
    render(<Harness tool="receipts" />);
    expect(screen.getByRole("radio", { name: "Open 2" }).getAttribute("aria-checked")).toBe("true");
  });

  it("falls back to Open and still switches when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Harness tool="receipts" />);
    expect(screen.getByRole("radio", { name: "Open 2" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Closed 3" }));
    expect(screen.getByRole("radio", { name: "Closed 3" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});

describe("Receipts job picker", () => {
  it("offers a Show all hint when only Closed projects match the search", () => {
    render(<ReceiptLogClient initialJobs={JOBS} initialValues={{ amount: "1.00" }} />);
    const input = screen.getByPlaceholderText("Search projects or type a one-off label");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "smith" } });
    const hint = screen.getByTestId("project-status-hint");
    expect(hint.textContent).toContain("No Open projects match “smith”. 2 Closed projects match");

    fireEvent.click(within(hint).getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("radio", { name: "All 4" }).getAttribute("aria-checked")).toBe("true");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "L01-25001 Smith ADUClosed",
      "L01-25002 Smithson GarageClosed",
    ]);
  });

  it("keeps a receipt's Closed project selected and listed under the Open view", () => {
    render(<ReceiptLogClient initialJobs={JOBS} initialValues={{ jobId: CLOSED_A.id }} />);
    expect(screen.getByRole("radio", { name: "Open 2" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Clear job").parentElement?.textContent).toContain(
      "L01-25001 Smith ADU",
    );
    expect(screen.getByLabelText("Clear job").parentElement?.textContent).toContain("Closed");
    fireEvent.focus(screen.getByPlaceholderText("Search projects or type a one-off label"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toContain("L01-25001 Smith ADUClosed");
  });
});

describe("Receipt Log job filter", () => {
  it("narrows job options only and keeps checked Closed jobs listed", () => {
    render(
      <ReceiptLogFiltersPanel
        initial={parseReceiptLogFiltersFromParams((key) => (key === "job" ? CLOSED_A.id : null))}
        userOptions={[]}
        jobOptions={[
          { id: OPEN.id, label: OPEN.label, projectStatus: "open" },
          { id: CLOSED_A.id, label: CLOSED_A.label, projectStatus: "closed" },
          { id: CLOSED_B.id, label: CLOSED_B.label, projectStatus: "closed" },
          { id: "custom:shop", label: "Shop (custom)", projectStatus: null },
        ]}
        vendorOptions={[]}
      />,
    );
    const checkboxes = screen
      .getAllByRole("checkbox")
      .map((box) => (box as HTMLInputElement).value);
    expect(checkboxes).toEqual([OPEN.id, "custom:shop", CLOSED_A.id]);
    fireEvent.click(screen.getByRole("radio", { name: "All 4" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });
});

const statuses: InventoryVocabValue[] = [
  {
    id: "status-ordered",
    label: "Ordered – not in",
    sortOrder: 0,
    isActive: true,
    isDefault: true,
  },
];

function inventoryItem(): InventoryItem {
  return {
    id: "item-1",
    orderId: null,
    jobId: CLOSED_A.id,
    customProjectLabel: null,
    projectLabel: "Closed Smith ADU",
    vendor: "build.com",
    orderNumber: "B-100",
    category: null,
    itemName: "Faucet",
    description: null,
    sku: "SKU-1",
    quantity: 1,
    unitCostCents: 100,
    totalCostCents: 100,
    productUrl: null,
    photoUrl: null,
    photoStoragePath: null,
    statusId: "status-ordered",
    statusLabel: "Ordered – not in",
    storageStateId: null,
    storageLabel: null,
    deliveryDate: null,
    outDate: null,
    notes: null,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("Inventory project filters", { timeout: 15000 }, () => {
  function renderInventory() {
    return render(
      <InventoryClient
        rows={[inventoryItem()]}
        filters={emptyInventoryFilters()}
        statuses={statuses}
        storageStates={[]}
        jobs={[
          { id: OPEN.id, label: OPEN.label, projectStatus: "open" },
          { id: CLOSED_A.id, label: "Closed Smith ADU", projectStatus: "closed" },
        ]}
        projectOptions={[
          { value: OPEN.id, label: OPEN.label, projectStatus: "open" },
          { value: CLOSED_A.id, label: "Closed Smith ADU", projectStatus: "closed" },
        ]}
        vendors={["build.com"]}
        orderNumbers={["B-100"]}
        isAdmin={false}
      />,
    );
  }

  it("keeps a Closed project's label on items under every filter view", () => {
    renderInventory();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const select = screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    const optionText = () => Array.from(select.options).map((o) => o.textContent);
    expect(optionText()).toEqual(["All projects", OPEN.label]);
    for (const name of ["Closed 1", "All 2", "Open 1"]) {
      fireEvent.click(screen.getByRole("radio", { name }));
      expect(screen.getAllByText("Closed Smith ADU").length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole("radio", { name: "Closed 1" }));
    expect(optionText()).toEqual(["All projects", "Closed Smith ADU (Closed)"]);
  });

  it("offers Closed projects in the item form once the toggle allows them", () => {
    renderInventory();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const project = screen.getAllByLabelText("Project").find((el) => el.tagName === "INPUT");
    if (!project) throw new Error("missing project field");
    fireEvent.focus(project);
    expect(screen.queryByRole("button", { name: "Closed Smith ADUClosed" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Closed 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Closed Smith ADUClosed" }));
    expect((project as HTMLInputElement).value).toBe("Closed Smith ADU");
    expect(screen.getByText(/This project is Closed on the Master Project Log/)).toBeTruthy();
  });
});

describe("InspectionProjectPicker", () => {
  it("never lists Closed projects and says so", () => {
    render(<InspectionProjectPicker jobs={JOBS} onPick={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText("Search projects or type a name"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([OPEN.label, CUSTOM.label]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(
      screen.getByText("Only Open projects from the Master Project Log are shown."),
    ).toBeTruthy();
  });
});

describe("ProjectSyncStatus", () => {
  it("shows the last refresh and counts from project rows", () => {
    const summary = summarizeProjectJobSync([
      job("a", "A", { updatedAt: "2026-10-20T17:05:00.000Z" }),
      job("b", "B", { projectStatus: "closed", updatedAt: "2026-10-19T10:00:00.000Z" }),
      job("c", "C", { source: "custom", updatedAt: "2026-10-21T10:00:00.000Z" }),
    ]);
    expect(summary).toEqual({
      lastRefreshedAt: "2026-10-20T17:05:00.000Z",
      projectRows: 2,
      counts: { open: 1, closed: 1, unknown: 0 },
    });
    render(<ProjectSyncStatus summary={summary} />);
    expect(screen.getByTestId("project-sync-last-refreshed").textContent).toMatch(
      /^Last refreshed from sheet: Oct 20, 10:05 AM PDT · 1 Open · 1 Closed · 0 Unknown/,
    );
    expect(screen.queryByTestId("project-status-unread-banner")).toBeNull();
  });

  it("warns when no project row has an Open/Closed status yet", () => {
    render(
      <ProjectSyncStatus
        summary={summarizeProjectJobSync([
          job("a", "A", { projectStatus: "unknown" }),
          job("b", "B", { projectStatus: "unknown" }),
        ])}
      />,
    );
    expect(screen.getByTestId("project-status-unread-banner").textContent).toBe(
      "No Open/Closed statuses have been read yet. Click Refresh from Master Project Log.",
    );
  });
});
