/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryClient } from "@/components/inventory/inventory-client";
import {
  INVENTORY_COLUMN_WIDTH_KEY,
  resetInventoryColumnWidths,
} from "@/lib/inventory/column-widths";
import {
  INVENTORY_COLUMN_ORDER_KEY,
  resetInventoryColumnOrder,
} from "@/lib/inventory/column-order";
import type { InventoryItem, InventoryVocabValue } from "@/lib/inventory/types";
import { emptyInventoryFilters } from "@/lib/inventory/filters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const statuses: InventoryVocabValue[] = [
  {
    id: "status-ordered",
    label: "Ordered – not in",
    sortOrder: 0,
    isActive: true,
    isDefault: true,
  },
  { id: "status-office", label: "In office", sortOrder: 1, isActive: true, isDefault: false },
];

const storage: InventoryVocabValue[] = [
  { id: "storage-yes", label: "Yes – in storage", sortOrder: 0, isActive: true, isDefault: true },
];

function item(
  partial: Partial<InventoryItem> & Pick<InventoryItem, "id" | "itemName">,
): InventoryItem {
  return {
    orderId: null,
    jobId: "job-1",
    customProjectLabel: null,
    projectLabel: "Chechetenko ADU",
    vendor: "build.com",
    orderNumber: "B-100",
    category: null,
    description: null,
    sku: partial.id,
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
    notes: "keep",
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  resetInventoryColumnWidths();
  resetInventoryColumnOrder();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("inventory table", () => {
  const rows = [item({ id: "a", itemName: "Faucet" }), item({ id: "b", itemName: "Valve" })];

  function renderTable() {
    return render(
      <InventoryClient
        rows={rows}
        matchingIds={["a", "b", "c"]}
        total={3}
        page={1}
        pageCount={2}
        filters={emptyInventoryFilters()}
        statuses={statuses}
        storageStates={storage}
        jobs={[{ id: "job-1", label: "Chechetenko ADU" }]}
        projectOptions={[{ value: "job-1", label: "Chechetenko ADU" }]}
        vendors={["build.com"]}
        orderNumbers={["B-100"]}
        isAdmin={false}
      />,
    );
  }

  it("selects visible rows, then every matching id, and bulk-edits only checked fields", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ updated: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();

    fireEvent.click(screen.getByLabelText("Select all visible rows"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Select all 3 matching/i }));
    expect(screen.getByText("3 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit selected" }));

    const statusToggle = screen
      .getAllByRole("checkbox")
      .find((node) => node.parentElement?.textContent?.includes("Set status"));
    const deliveryToggle = screen.getByLabelText("Set delivery date");
    if (!statusToggle) throw new Error("missing status toggle");
    fireEvent.click(statusToggle);
    fireEvent.click(deliveryToggle);
    fireEvent.change(screen.getByLabelText("Bulk status"), { target: { value: "status-office" } });
    fireEvent.change(screen.getByLabelText("Bulk delivery date"), {
      target: { value: "2026-09-29" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.ids.sort()).toEqual(["a", "b", "c"]);
    expect(body.patch).toEqual({ statusId: "status-office", deliveryDate: "2026-09-29" });
    expect(body.patch).not.toHaveProperty("storageStateId");
    expect(body.patch).not.toHaveProperty("outDate");
  });

  it("keeps a build.com PDF in review until the user imports", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Import PDF" }));
    expect(screen.getByText(/review every line before it is saved/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Import \d+ items/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review lines" }));
    expect(screen.getByText(/Choose a build.com order PDF/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes one item and a bulk selection only after confirm", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ deleted: 1 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();

    fireEvent.click(screen.getAllByLabelText("Select Faucet")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(screen.getByRole("heading", { name: "Delete Faucet?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText("Faucet").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.ids).toEqual(["a"]);
    expect(screen.queryByText("Faucet")).toBeNull();

    cleanup();
    fetchMock.mockClear();
    renderTable();
    fireEvent.click(screen.getByLabelText("Select all visible rows"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(screen.getByRole("heading", { name: "Delete 2 items?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete items" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Faucet")).toBeNull();
    expect(screen.queryByText("Valve")).toBeNull();
  });

  it("renders thumbnail sizes, persists the choice, and leaves a gap when there is no photo", () => {
    const { unmount } = render(
      <InventoryClient
        rows={[item({ id: "a", itemName: "Faucet", photoUrl: "https://example.com/faucet.png" })]}
        matchingIds={["a"]}
        total={1}
        page={1}
        pageCount={1}
        filters={emptyInventoryFilters()}
        statuses={statuses}
        storageStates={storage}
        jobs={[{ id: "job-1", label: "Chechetenko ADU" }]}
        projectOptions={[{ value: "job-1", label: "Chechetenko ADU" }]}
        vendors={["build.com"]}
        orderNumbers={["B-100"]}
        isAdmin={false}
      />,
    );
    const photo = screen.getAllByRole("button", { name: "View photo of Faucet" })[0]!;
    expect(photo.querySelector("img")?.className).toContain("h-8");
    expect(screen.queryAllByLabelText("No photo for Valve")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Large thumbnails" }));
    expect(photo.querySelector("img")?.className).toContain("h-24");
    expect(
      screen.getByRole("button", { name: "Large thumbnails" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(photo);
    expect(screen.getByRole("img", { name: "Faucet" }).getAttribute("src")).toBe(
      "https://example.com/faucet.png",
    );
    unmount();
    renderTable();
    expect(
      screen.getByRole("button", { name: "Large thumbnails" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getAllByLabelText("No photo for Faucet")[0]?.className).toContain("h-24");
    expect(screen.getAllByLabelText("No photo for Faucet")[0]?.className).not.toContain("min-w-");
  });

  it("inserts a saved item immediately and rolls a failed save back", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.itemName === "Broken") {
        return new Response(JSON.stringify({ error: { message: "SKU is required" } }), {
          status: 400,
        });
      }
      return new Response(
        JSON.stringify({
          item: item({
            id: "11111111-1111-4111-8111-111111111111",
            itemName: body.itemName,
            sku: body.sku,
            quantity: body.quantity,
            unitCostCents: 500,
            totalCostCents: 500,
          }),
        }),
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByLabelText("Item name").closest("label")?.textContent).toMatch(
      /Item name\s*\*/,
    );
    const vendor = screen
      .getAllByLabelText("Vendor")
      .find((element) => element.tagName === "INPUT");
    expect(vendor?.closest("label")?.textContent).not.toMatch(/\*/);
    expect(screen.getByLabelText("Notes").closest("label")?.textContent).not.toMatch(/\*/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Item name is required")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Broken" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "BAD" } });
    fireEvent.change(screen.getByLabelText("Unit cost"), { target: { value: "1.00" } });
    const project = screen
      .getAllByLabelText("Project")
      .find((element) => element.tagName === "INPUT");
    if (!project) throw new Error("missing project field");
    fireEvent.focus(project);
    fireEvent.click(screen.getByRole("button", { name: "Chechetenko ADU" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("SKU is required")).toBeTruthy());
    expect(screen.queryByText("Broken")).toBeNull();

    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "New faucet" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "NEW-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByText("New faucet").length).toBeGreaterThan(0));
  });

  it("updates an edited item without a refresh", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ item: item({ id: "a", itemName: "Faucet revised" }) }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderTable();
    fireEvent.click(screen.getAllByText("Faucet")[0]!);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Faucet revised" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByText("Faucet revised").length).toBeGreaterThan(0));
    expect(screen.queryByText("Faucet")).toBeNull();
  });

  it("keeps filters collapsed until the URL already has some", () => {
    renderTable();
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Apply filters" })).toBeNull();
    cleanup();
    render(
      <InventoryClient
        rows={rows}
        matchingIds={["a", "b"]}
        total={2}
        page={1}
        pageCount={1}
        filters={{ ...emptyInventoryFilters(), vendor: "build.com", q: "faucet" }}
        statuses={statuses}
        storageStates={storage}
        jobs={[{ id: "job-1", label: "Chechetenko ADU" }]}
        projectOptions={[{ value: "job-1", label: "Chechetenko ADU" }]}
        vendors={["build.com"]}
        orderNumbers={["B-100"]}
        isAdmin={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide filters" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByText("2 filters active")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeTruthy();
  });

  it("puts the photo in the first column without crowding vendor", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
    expect(headers[1]).toBe("Photo");
    expect(headers[2]).toMatch(/^Vendor/);
    const photo = screen.getAllByTestId("inventory-photo")[0];
    expect(photo?.className).toContain("overflow-hidden");
    expect(photo?.className).toContain("w-36");
    expect(photo?.nextElementSibling?.textContent).toContain("build.com");
    fireEvent.click(screen.getByRole("button", { name: "Large thumbnails" }));
    expect(photo?.querySelector("[aria-label^='No photo']")?.className).toContain("h-24");
    expect(photo?.nextElementSibling?.textContent).toContain("build.com");
  });

  it("saves status inline, keeps rapid edits, and rolls a failure back", async () => {
    const pending = new Map<string, (response: Response) => void>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      return new Promise<Response>((resolve) => {
        pending.set(String(url), resolve);
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();

    const faucetStatus = screen.getAllByLabelText("Status for Faucet")[0] as HTMLSelectElement;
    faucetStatus.focus();
    expect(document.activeElement).toBe(faucetStatus);
    fireEvent.click(faucetStatus);
    expect(screen.queryByRole("heading", { name: "Edit item" })).toBeNull();
    fireEvent.keyDown(faucetStatus, { key: "ArrowDown" });
    fireEvent.change(faucetStatus, { target: { value: "status-office" } });
    fireEvent.change(screen.getAllByLabelText("Status for Valve")[0]!, {
      target: { value: "status-office" },
    });
    expect(faucetStatus.value).toBe("status-office");
    expect((screen.getAllByLabelText("Status for Valve")[0] as HTMLSelectElement).value).toBe(
      "status-office",
    );

    await waitFor(() => expect(pending.size).toBe(2));
    const stale = (id: string, name: string) =>
      new Response(
        JSON.stringify({
          item: item({
            id,
            itemName: name,
            statusId: "status-ordered",
            statusLabel: "Ordered – not in",
          }),
        }),
        { status: 200 },
      );
    pending.get("/api/inventory/b")?.(stale("b", "Valve"));
    pending.get("/api/inventory/a")?.(stale("a", "Faucet"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((screen.getAllByLabelText("Status for Faucet")[0] as HTMLSelectElement).value).toBe(
      "status-office",
    );
    expect((screen.getAllByLabelText("Status for Valve")[0] as HTMLSelectElement).value).toBe(
      "status-office",
    );
    const sent = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).statusId);
    expect(sent).toEqual(["status-office", "status-office"]);

    fireEvent.click(screen.getAllByText("Faucet")[0]!);
    expect(screen.getByRole("heading", { name: "Edit item" })).toBeTruthy();
  });

  it("rolls an inline save back when the server rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Status is no longer available" } }), {
            status: 400,
          }),
      ),
    );
    renderTable();
    fireEvent.change(screen.getAllByLabelText("Out of storage for Faucet")[0]!, {
      target: { value: "storage-yes" },
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Faucet/));
    expect(screen.getByRole("alert").textContent).toMatch(/Status is no longer available/);
    expect(
      (screen.getAllByLabelText("Out of storage for Faucet")[0] as HTMLSelectElement).value,
    ).toBe("");
  });

  it("shows imported rows immediately and rolls them back if the commit fails", async () => {
    const saved = item({ id: "imported", itemName: "Kraus faucet", sku: "KR-1" });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/inventory/import")) {
        return new Response(
          JSON.stringify({
            status: "ready",
            draft: {
              sha256: "a".repeat(64),
              storagePath: "orders/x.pdf",
              orderNumber: "95855811",
              vendor: "build.com",
              source: "text",
              correctionAttempted: false,
              textUsable: true,
              duplicate: null,
              lines: [
                {
                  itemName: "Kraus faucet",
                  sku: "KR-1",
                  description: "Brushed gold",
                  quantity: 1,
                  unitCostCents: 100,
                  lineTotalCents: 100,
                  productUrl: null,
                  photoStoragePath: null,
                  photoUrl: null,
                  source: "text",
                  flags: [],
                  pageNumber: 1,
                },
              ],
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({ error: { message: "This order is already imported" } }),
        { status: 400 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Import PDF" }));
    const file = new File(["%PDF-1.4"], "order.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Order PDF"), { target: { files: [file] } });
    fireEvent.focus(screen.getByLabelText("Import project"));
    fireEvent.click(screen.getByRole("button", { name: "Chechetenko ADU" }));
    fireEvent.click(screen.getByRole("button", { name: "Review lines" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import 1 items" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import 1 items" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already imported/));
    expect(screen.getByText("3 items")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Edit item" })).toBeNull();

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/inventory/import/commit")) {
        return new Response(JSON.stringify({ orderId: "order-1", itemCount: 1, items: [saved] }), {
          status: 201,
        });
      }
      return new Response("no", { status: 500 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 items" }));
    await waitFor(() => expect(screen.getByText("4 items")).toBeTruthy());
    expect(screen.getAllByText("Kraus faucet").length).toBeGreaterThan(0);
  });

  it("resizes a column, keeps the width, and still sorts from the header", () => {
    renderTable();
    const handle = screen.getByRole("separator", { name: "Resize Item column" });
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window);
    const header = () => screen.getByRole("columnheader", { name: /Item/ });
    expect(header().style.width).toBe("280px");
    expect(localStorage.getItem(INVENTORY_COLUMN_WIDTH_KEY)).toContain("280");
    const sort = screen.getByRole("link", { name: /^Item/ });
    expect(sort.getAttribute("href")).toBe("/inventory?dir=desc");
    fireEvent.click(handle);
    expect(sort.getAttribute("href")).toBe("/inventory?dir=desc");
    cleanup();
    renderTable();
    expect(screen.getByRole("columnheader", { name: /Item/ }).style.width).toBe("280px");
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getByRole("columnheader", { name: /Item/ }).style.width).toBe("200px");
    expect(localStorage.getItem(INVENTORY_COLUMN_WIDTH_KEY)).toBeNull();
    expect(screen.queryByTestId("column-resize-guide")).toBeNull();
  });

  it("shows a resize divider at rest, a guide while dragging, and no divider on the checkbox", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]?.querySelector("[role='separator']")).toBeNull();
    const handles = screen.getAllByRole("separator");
    expect(handles).toHaveLength(headers.length - 1);
    for (const handle of handles) {
      expect(handle.className).toContain("w-4");
      expect(handle.className).toContain("cursor-col-resize");
      const line = handle.firstElementChild;
      expect(line?.className).toContain("w-px");
      expect(line?.className).toContain("bg-[#4a5c6e]");
      expect(line?.className).toContain("group-hover:bg-[#1a2733]");
    }
    const handle = screen.getByRole("separator", { name: "Resize Item column" });
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 140 });
    expect(screen.getByTestId("column-resize-guide")).toBeTruthy();
    expect(handle.firstElementChild?.className).toContain("bg-[var(--acton-navy)]");
    fireEvent.pointerUp(window);
    expect(screen.queryByTestId("column-resize-guide")).toBeNull();
    const sort = screen.getByRole("link", { name: /^Item/ });
    fireEvent.click(sort);
    expect(screen.queryByTestId("column-resize-guide")).toBeNull();
    expect(sort.getAttribute("href")).toBe("/inventory?dir=desc");
  });

  it("reorders a column when its header is dragged and keeps that order", () => {
    renderTable();
    const category = screen.getByRole("link", { name: /^Category/ });
    expect(category.getAttribute("href")).toContain("sort=category");
    fireEvent.pointerDown(category, { clientX: 20 });
    fireEvent.pointerMove(window, { clientX: 24 });
    fireEvent.pointerUp(window, { clientX: 24 });
    expect(screen.getAllByRole("columnheader").at(-1)?.textContent).not.toMatch(/Category/);
    fireEvent.pointerDown(category, { clientX: 20 });
    fireEvent.pointerMove(window, { clientX: 420 });
    expect(screen.getByTestId("column-reorder-guide")).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: 420 });
    expect(screen.getAllByRole("columnheader").at(-1)?.textContent).toMatch(/Category/);
    expect(screen.getAllByRole("columnheader")[1]?.textContent).toMatch(/Photo/);
    expect(localStorage.getItem(INVENTORY_COLUMN_ORDER_KEY)).toMatch(/"category"/);
    expect(category.getAttribute("href")).toContain("sort=category");
    cleanup();
    renderTable();
    expect(screen.getAllByRole("columnheader").at(-1)?.textContent).toMatch(/Category/);
  });

  it("searches as you type and writes the query into the URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("q=nickel")) {
        return new Response(
          JSON.stringify({
            rows: [item({ id: "a", itemName: "Faucet", description: "brushed nickel" })],
            total: 1,
            matchingIds: ["a"],
            page: 1,
            pageCount: 1,
          }),
        );
      }
      return new Response(JSON.stringify({ rows: rows, total: 3, matchingIds: ["a", "b", "c"] }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const search = screen.getByPlaceholderText(
      "Search by item, vendor, order #, category, description…",
    );
    fireEvent.change(search, { target: { value: "n" } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "nickel" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("q=nickel");
    expect(window.location.pathname + window.location.search).toContain("q=nickel");
    await waitFor(() => expect(screen.queryByText("Valve")).toBeNull());
    expect(screen.getByText("1 item")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply filters" })).toBeTruthy();
  });

  it("saves and clears delivery and out dates inline without opening the item", async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      void init;
      return new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTable();
    const stale = () =>
      new Response(
        JSON.stringify({
          item: item({
            id: "stale",
            itemName: "Stale",
            deliveryDate: null,
            outDate: "2020-01-01",
            statusId: "status-ordered",
            statusLabel: "Ordered – not in",
          }),
        }),
        { status: 200 },
      );

    fireEvent.click(screen.getAllByRole("button", { name: "Delivery date for Faucet" })[0]!);
    expect(screen.queryByRole("heading", { name: "Edit item" })).toBeNull();
    const delivery = screen.getAllByLabelText(
      "Delivery date for Faucet value",
    )[0] as HTMLInputElement;
    expect(delivery.type).toBe("date");
    fireEvent.change(delivery, { target: { value: "2026-10-02" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save date" })[0]!);
    fireEvent.change(screen.getAllByLabelText("Status for Valve")[0]!, {
      target: { value: "status-office" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Out date for Valve" })[0]!);
    fireEvent.change(screen.getAllByLabelText("Out date for Valve value")[0]!, {
      target: { value: "2026-11-03" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save date" })[0]!);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    expect(
      screen.getAllByRole("button", { name: "Delivery date for Faucet" })[0]?.textContent,
    ).toBe("2026-10-02");
    expect((screen.getAllByLabelText("Status for Valve")[0] as HTMLSelectElement).value).toBe(
      "status-office",
    );
    expect(screen.getAllByRole("button", { name: "Out date for Valve" })[0]?.textContent).toBe(
      "2026-11-03",
    );
    pending[0]?.(stale());
    pending[1]?.(stale());
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Out date for Valve" })[0]?.textContent).toBe(
        "2026-11-03",
      ),
    );
    expect((screen.getAllByLabelText("Status for Valve")[0] as HTMLSelectElement).value).toBe(
      "status-office",
    );
    expect(
      screen.getAllByRole("button", { name: "Delivery date for Faucet" })[0]?.textContent,
    ).toBe("2026-10-02");
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies.some((body) => body.deliveryDate === "2026-10-02")).toBe(true);
    expect(
      bodies.some((body) => body.outDate === "2026-11-03" && body.statusId === "status-office"),
    ).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Delivery date for Faucet" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear date" })[0]!);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => JSON.parse(String(call[1]?.body)).deliveryDate === null,
        ),
      ).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: "Edit item" })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Delivery date for Faucet" })[0]?.textContent,
    ).toMatch(/—{8,}/);
    expect(
      screen.getAllByRole("button", { name: "Delivery date for Faucet" })[0]?.className,
    ).toContain("w-full");
  });

  it("drops the extra Filters label and matches Import PDF to Add item", () => {
    renderTable();
    expect(screen.getAllByText("Filters")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Filters" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    const add = screen.getByRole("button", { name: "Add item" });
    const imported = screen.getByRole("button", { name: "Import PDF" });
    expect(imported.className).toContain("bg-[var(--acton-navy)]");
    expect(add.className).toContain("bg-[var(--acton-navy)]");
    expect(imported.className).not.toContain("bg-white");
  });

  it("accepts a dropped PDF, rejects other files, and stays keyboard reachable", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Import PDF" }));
    const zone = screen.getByRole("button", { name: "Upload order PDF" });
    expect(zone.tabIndex).toBe(0);
    fireEvent.keyDown(zone, { key: "Enter" });
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["%PDF"], "order.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByText("order.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.queryByText("order.pdf")).toBeNull();
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Only PDF files can be imported/);
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("uses a card list on small screens without a wide table", () => {
    const { container } = renderTable();
    const cards = screen.getByTestId("inventory-cards");
    expect(cards.className).toContain("md:hidden");
    expect(cards.className).not.toContain("min-w-");
    expect(cards.className).not.toContain("overflow-x-auto");
    const card = cards.querySelector("li");
    expect(card?.className).toContain("overflow-hidden");
    const tableWrap = container.querySelector("div.hidden.md\\:block");
    expect(tableWrap).toBeTruthy();
    expect(tableWrap?.className).toContain("hidden");
    expect(tableWrap?.className).toContain("md:block");
  });
});
