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
