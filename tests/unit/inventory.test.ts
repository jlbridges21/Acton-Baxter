import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyInventoryBulkPatch } from "@/lib/inventory/bulk";
import { buildInventoryCsv } from "@/lib/inventory/csv";
import {
  applyInventoryQuery,
  buildInventoryQuery,
  emptyInventoryFilters,
  parseInventoryFilters,
  sortInventoryItems,
} from "@/lib/inventory/filters";
import { parseInventoryUnitCostToCents } from "@/lib/inventory/money";
import {
  bulkUpdateInventoryItems,
  createInventoryItem,
  deleteInventoryVocab,
  listInventoryVocab,
  queryInventory,
  rememberInventoryJobLabelForTests,
  resetInventoryMemoryForTests,
  type InventoryItemInput,
} from "@/lib/inventory/store";
import {
  INVENTORY_PAGE_SIZE,
  INVENTORY_SORT_KEYS,
  type InventoryItem,
} from "@/lib/inventory/types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function baseInput(overrides: Partial<InventoryItemInput> = {}): InventoryItemInput {
  return {
    itemName: "Kitchen faucet",
    sku: "SKU-1",
    quantity: 2,
    unitCostCents: 4250,
    jobId: JOB_ID,
    actorId: ACTOR,
    vendor: "build.com",
    orderNumber: "B-100",
    ...overrides,
  };
}

beforeEach(() => {
  resetInventoryMemoryForTests();
  rememberInventoryJobLabelForTests(JOB_ID, "Chechetenko ADU");
});

describe("inventory money", () => {
  it("stores dollars as integer cents and allows zero", () => {
    expect(parseInventoryUnitCostToCents("42.50")).toBe(4250);
    expect(parseInventoryUnitCostToCents("$1,234.5")).toBe(123450);
    expect(parseInventoryUnitCostToCents("0")).toBe(0);
    expect(parseInventoryUnitCostToCents(0)).toBe(0);
  });

  it("rejects negative and unparsable amounts", () => {
    expect(() => parseInventoryUnitCostToCents("-1")).toThrow(/negative|valid/i);
    expect(() => parseInventoryUnitCostToCents("12.345")).toThrow(/valid/i);
    expect(() => parseInventoryUnitCostToCents("")).toThrow(/required/i);
  });
});

describe("inventory manual entry", () => {
  it("stores cents and a computed total on the shared project list", async () => {
    const item = await createInventoryItem(baseInput());
    expect(item.jobId).toBe(JOB_ID);
    expect(item.customProjectLabel).toBeNull();
    expect(item.projectLabel).toBe("Chechetenko ADU");
    expect(item.unitCostCents).toBe(4250);
    expect(item.totalCostCents).toBe(8500);
    expect(item.statusLabel).toBe("Ordered – not in");
  });

  it("accepts a free-text project without creating another project list", async () => {
    const item = await createInventoryItem(
      baseInput({ jobId: null, customProjectLabel: "Garage remodel" }),
    );
    expect(item.jobId).toBeNull();
    expect(item.customProjectLabel).toBe("Garage remodel");
    expect(item.projectLabel).toBe("Garage remodel");
  });

  it("rejects empty required fields", async () => {
    await expect(createInventoryItem(baseInput({ itemName: "  " }))).rejects.toThrow(/item name/i);
    await expect(createInventoryItem(baseInput({ sku: "" }))).rejects.toThrow(/sku/i);
    await expect(createInventoryItem(baseInput({ quantity: 0 }))).rejects.toThrow(/quantity/i);
    await expect(createInventoryItem(baseInput({ unitCostCents: -1 }))).rejects.toThrow(
      /negative/i,
    );
    await expect(
      createInventoryItem(baseInput({ jobId: null, customProjectLabel: " " })),
    ).rejects.toThrow(/project/i);
  });
});

describe("inventory query", () => {
  async function seed() {
    const inOffice = (await listInventoryVocab("status")).find(
      (status) => status.label === "In office",
    )!;
    const notIn = (await listInventoryVocab("storage")).find(
      (state) => state.label === "No – not in storage",
    )!;
    await createInventoryItem(
      baseInput({
        itemName: "Faucet",
        sku: "AAA",
        description: "brushed nickel",
        vendor: "build.com",
        orderNumber: "B-100",
      }),
    );
    await createInventoryItem(
      baseInput({
        itemName: "Valve",
        sku: "BBB",
        description: "angle stop",
        vendor: "build.com",
        orderNumber: "B-100",
        statusId: inOffice.id,
        storageStateId: notIn.id,
      }),
    );
    await createInventoryItem(
      baseInput({
        itemName: "Tile",
        sku: "CCC",
        vendor: "other",
        orderNumber: "O-9",
        customProjectLabel: "Side job",
        jobId: null,
      }),
    );
    return { inOffice, notIn };
  }

  it("filters each field alone and together", async () => {
    const { inOffice, notIn } = await seed();
    const vendor = await queryInventory({ ...emptyInventoryFilters(), vendor: "build.com" });
    expect(vendor.total).toBe(2);
    const order = await queryInventory({ ...emptyInventoryFilters(), orderNumber: "B-100" });
    expect(order.total).toBe(2);
    const project = await queryInventory({ ...emptyInventoryFilters(), project: JOB_ID });
    expect(project.rows.map((row) => row.itemName).sort()).toEqual(["Faucet", "Valve"]);
    const custom = await queryInventory({ ...emptyInventoryFilters(), project: "custom:Side job" });
    expect(custom.rows.map((row) => row.itemName)).toEqual(["Tile"]);
    const status = await queryInventory({ ...emptyInventoryFilters(), statusId: inOffice.id });
    expect(status.rows.map((row) => row.itemName)).toEqual(["Valve"]);
    const storage = await queryInventory({ ...emptyInventoryFilters(), storageStateId: notIn.id });
    expect(storage.rows.map((row) => row.itemName)).toEqual(["Valve"]);
    const search = await queryInventory({ ...emptyInventoryFilters(), q: "nickel" });
    expect(search.rows.map((row) => row.sku)).toEqual(["AAA"]);
    const combined = await queryInventory({
      ...emptyInventoryFilters(),
      vendor: "build.com",
      orderNumber: "B-100",
      q: "valve",
      statusId: inOffice.id,
    });
    expect(combined.rows).toHaveLength(1);
    expect(combined.rows[0]?.itemName).toBe("Valve");
  });

  it("sorts every column", async () => {
    await seed();
    const items = (await queryInventory(emptyInventoryFilters())).rows;
    for (const key of INVENTORY_SORT_KEYS) {
      const asc = sortInventoryItems(items, key, "asc").map((row) => row.id);
      const desc = sortInventoryItems(items, key, "desc").map((row) => row.id);
      expect(asc).toHaveLength(items.length);
      expect(desc).toHaveLength(items.length);
      expect(desc).toEqual([...asc].reverse());
    }
  });

  it("round-trips filter state through the URL", () => {
    const filters = {
      ...emptyInventoryFilters(),
      q: "angle stop",
      project: JOB_ID,
      vendor: "build.com",
      orderNumber: "B-100",
      statusId: "33333333-3333-4333-8333-333333333333",
      storageStateId: "44444444-4444-4444-8444-444444444444",
      sort: "sku" as const,
      dir: "desc" as const,
      page: 2,
    };
    const parsed = parseInventoryFilters(
      new URLSearchParams(buildInventoryQuery(filters).slice(1)),
    );
    expect(parsed).toEqual(filters);
  });

  it("pages results and still returns every matching id", async () => {
    for (let index = 0; index < INVENTORY_PAGE_SIZE + 1; index += 1) {
      await createInventoryItem(baseInput({ itemName: `Item ${index}`, sku: `S-${index}` }));
    }
    const page = await queryInventory(emptyInventoryFilters());
    expect(page.rows).toHaveLength(INVENTORY_PAGE_SIZE);
    expect(page.matchingIds).toHaveLength(INVENTORY_PAGE_SIZE + 1);
    expect(page.pageCount).toBe(2);
  });
});

describe("inventory bulk edit", () => {
  it("changes only fields present on the patch", () => {
    const item = {
      statusId: "old-status",
      storageStateId: "old-storage",
      deliveryDate: null,
      outDate: "2026-01-02",
      notes: "keep me",
      vendor: "build.com",
    } as InventoryItem;
    const next = applyInventoryBulkPatch(item, {
      statusId: "new-status",
      deliveryDate: "2026-09-29",
    });
    expect(next.statusId).toBe("new-status");
    expect(next.deliveryDate).toBe("2026-09-29");
    expect(next.storageStateId).toBe("old-storage");
    expect(next.outDate).toBe("2026-01-02");
    expect(next.notes).toBe("keep me");
    expect(next.vendor).toBe("build.com");
  });

  it("marks a filtered build.com order in office with a delivery date", async () => {
    const inOffice = (await listInventoryVocab("status")).find(
      (status) => status.label === "In office",
    )!;
    const first = await createInventoryItem(
      baseInput({ itemName: "Faucet", notes: "leave notes" }),
    );
    const second = await createInventoryItem(
      baseInput({ itemName: "Valve", outDate: "2026-01-01" }),
    );
    const other = await createInventoryItem(
      baseInput({ itemName: "Tile", vendor: "other", orderNumber: "Z" }),
    );
    const matched = await queryInventory({
      ...emptyInventoryFilters(),
      vendor: "build.com",
      orderNumber: "B-100",
    });
    expect(matched.matchingIds.sort()).toEqual([first.id, second.id].sort());
    await bulkUpdateInventoryItems({
      ids: matched.matchingIds,
      patch: { statusId: inOffice.id, deliveryDate: "2026-09-29" },
      actorId: ACTOR,
    });
    const after = await queryInventory(emptyInventoryFilters());
    const byName = new Map(after.rows.map((row) => [row.itemName, row]));
    expect(byName.get("Faucet")?.statusLabel).toBe("In office");
    expect(byName.get("Faucet")?.deliveryDate).toBe("2026-09-29");
    expect(byName.get("Faucet")?.notes).toBe("leave notes");
    expect(byName.get("Faucet")?.outDate).toBeNull();
    expect(byName.get("Valve")?.statusLabel).toBe("In office");
    expect(byName.get("Valve")?.outDate).toBe("2026-01-01");
    expect(byName.get("Tile")?.statusLabel).toBe("Ordered – not in");
    expect(byName.get("Tile")?.deliveryDate).toBeNull();
    expect(other.vendor).toBe("other");
  });
});

describe("inventory vocabularies", () => {
  it("blocks delete while items reference the value, then reassigns", async () => {
    const statuses = await listInventoryVocab("status");
    const ordered = statuses.find((status) => status.label === "Ordered – not in")!;
    const aside = statuses.find((status) => status.label === "Set aside")!;
    const item = await createInventoryItem(baseInput({ statusId: aside.id }));
    await expect(deleteInventoryVocab("status", aside.id)).rejects.toThrow(/still use/i);
    const result = await deleteInventoryVocab("status", aside.id, ordered.id);
    expect(result.reassigned).toBe(1);
    const reloaded = await queryInventory(emptyInventoryFilters());
    expect(reloaded.rows.find((row) => row.id === item.id)?.statusLabel).toBe("Ordered – not in");
    expect((await listInventoryVocab("status")).some((status) => status.id === aside.id)).toBe(
      false,
    );
  });

  it("refuses to delete the last value", async () => {
    const storage = await listInventoryVocab("storage");
    for (const value of storage.slice(1)) {
      await deleteInventoryVocab("storage", value.id);
    }
    const last = (await listInventoryVocab("storage"))[0]!;
    await expect(deleteInventoryVocab("storage", last.id)).rejects.toThrow(/at least one/i);
  });
});

describe("inventory csv", () => {
  it("exports filtered rows with decimal dollars", async () => {
    await createInventoryItem(baseInput({ itemName: "Faucet", unitCostCents: 4250, quantity: 2 }));
    await createInventoryItem(
      baseInput({ itemName: "Tile", vendor: "other", unitCostCents: 100, quantity: 1 }),
    );
    const matched = applyInventoryQuery((await queryInventory(emptyInventoryFilters())).rows, {
      ...emptyInventoryFilters(),
      vendor: "build.com",
    });
    const csv = buildInventoryCsv(matched.rows);
    expect(csv).toContain("Faucet");
    expect(csv).not.toContain("Tile");
    expect(csv).toContain("42.50");
    expect(csv).toContain("85.00");
    expect(csv).not.toContain("4250");
  });
});

describe("inventory RLS migration", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase/migrations/058_inventory.sql"),
    "utf8",
  );

  it("lets app-access roles read and write items and keeps vocabularies admin-only", () => {
    expect(sql).toContain("function public.is_app_access()");
    expect(sql).toContain("p.role in ('user', 'admin', 'super_admin')");
    expect(sql).toContain("App access can read inventory items");
    expect(sql).toContain("App access can insert inventory items");
    expect(sql).toContain("App access can update inventory items");
    expect(sql).toContain("using (public.is_app_access() and deleted_at is null)");
    expect(sql).toContain("Admins insert inventory statuses");
    expect(sql).toContain("Admins update inventory statuses");
    expect(sql).toContain("Admins delete inventory statuses");
    expect(sql).toContain("Admins delete inventory storage states");
    expect(sql).toContain("with check (public.is_admin())");
    expect(sql).toContain("references public.expense_jobs");
    expect(sql).toContain(
      "total_cost_cents integer generated always as (quantity * unit_cost_cents) stored",
    );
    expect(sql).not.toMatch(
      /inventory_statuses for (insert|update|delete)[\s\S]{0,80}is_app_access/,
    );
  });
});
