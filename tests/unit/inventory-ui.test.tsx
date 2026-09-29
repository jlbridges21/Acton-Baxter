/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryClient } from "@/components/inventory/inventory-client";
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
