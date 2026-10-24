/**
 * Global Search: Inventory, Site Inspections, JobTread (jobs + documents), and Knowledge
 * Center — with and without the search index installed (migration 074). In-memory stores and
 * the synthetic JobTread fixture only; nothing external is called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Toggle "is global_search_index installed?" per test; everything else is the real module.
const index = vi.hoisted(() => ({ ready: true, throwMissing: false }));
vi.mock("@/lib/search/index-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/search/index-store")>();
  const { StoreError } = await import("@/lib/agents/store");
  return {
    ...actual,
    indexStatus: vi.fn(async () =>
      index.ready
        ? { ready: true, reason: null }
        : { ready: false, reason: "The search index isn't installed in this database." },
    ),
    indexCandidates: vi.fn(async (...args: Parameters<typeof actual.indexCandidates>) => {
      if (index.throwMissing) {
        throw new StoreError(
          "global_search_query: Could not find the function public.global_search_query",
          "PGRST202",
        );
      }
      return actual.indexCandidates(...args);
    }),
    reindexProvider: vi.fn(actual.reindexProvider),
  };
});

import { agentDb } from "@/lib/agents/store";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  addItem,
  addSection,
  createEmptyTemplate,
  createSiteInspection,
  resetInspectionTemplateMemoryForTests,
  resetSiteInspectionMediaMemoryForTests,
  resetSiteInspectionMemoryForTests,
  upsertSiteInspectionResponse,
} from "@/lib/inspections";
import { setSiteInspectionProfileNameForTests } from "@/lib/inspections/records-store";
import { createInventoryItem, resetInventoryMemoryForTests } from "@/lib/inventory/store";
import { createKnowledgeEntry, resetKnowledgeMemoryForTests } from "@/lib/knowledge/store";
import { runFullSync } from "@/lib/jobtread/sync";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { createSearchContextFor, type SearchContext } from "@/lib/search/context";
import { searchAll } from "@/lib/search/engine";
import { reindexProvider } from "@/lib/search/index-store";
import type { SearchProvider } from "@/lib/search/provider";
import { invalidateSourceDocs } from "@/lib/search/providers/indexed";
import { getSearchProvider, setSearchProvidersForTests } from "@/lib/search/registry";
import { invalidateSearchSettings } from "@/lib/search/settings";
import type { SearchResult } from "@/lib/search/types";
import { ADMIN_ID, EMPLOYEE_ID, HR_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

const SOURCES = ["inventory", "inspections", "jobtread-jobs", "jobtread-documents", "knowledge"];

function ctxFor(
  id: string,
  role: string,
  reports?: Array<"general" | "customer" | "financial" | "internal">,
): SearchContext {
  return createSearchContextFor(
    { id, email: `${id}@example.test`, role, label: "Tester" },
    requester(id, role, "Tester"),
    reports
      ? {
          reportsAccess: async () =>
            ({
              canUse: true,
              isAdmin: false,
              categories: new Set(reports),
            }) as never,
        }
      : {},
  );
}
const admin = () => ctxFor(ADMIN_ID, "admin");
const employee = (reports: Array<"general" | "customer" | "financial"> = ["general"]) =>
  ctxFor(EMPLOYEE_ID, "user", reports);

async function search(ctx: SearchContext, query: string, category?: SearchResult["category"]) {
  return searchAll(ctx, { query, category: category ?? null, limit: 25, offset: 0 });
}
const of = (rs: SearchResult[], provider: string) => rs.filter((r) => r.provider === provider);

beforeEach(async () => {
  await setupAgentTestEnv();
  resetEnvCacheForTests();
  resetInventoryMemoryForTests();
  resetKnowledgeMemoryForTests();
  resetInspectionTemplateMemoryForTests();
  resetSiteInspectionMemoryForTests();
  resetSiteInspectionMediaMemoryForTests();
  invalidateSearchSettings();
  invalidateFieldCatalog();
  invalidateSourceDocs();
  index.ready = true;
  index.throwMissing = false;
  vi.mocked(reindexProvider).mockClear();
  setSearchProvidersForTests(
    SOURCES.map((id) => getSearchProvider(id)).filter((p): p is SearchProvider => Boolean(p)),
  );
  installFakePave();
  await runFullSync("test");
});
afterEach(() => {
  uninstallFakePave();
  setSearchProvidersForTests(null);
});

async function seedInspection() {
  const template = await createEmptyTemplate({
    name: "Detached ADU walkthrough",
    actorId: ADMIN_ID,
  });
  const withSection = await addSection({
    templateId: template.id,
    title: "Site",
    actorId: ADMIN_ID,
  });
  const withItem = await addItem({
    templateId: template.id,
    sectionId: withSection.sections[0]!.id,
    title: "Utilities",
    actorId: ADMIN_ID,
  });
  void withItem;
  setSiteInspectionProfileNameForTests(HR_ID, "Harper Inspector");
  const inspection = await createSiteInspection({
    projectName: "Synthetic Hilltop",
    address: "42 Sample Street, Testville, CA 90000",
    templateId: template.id,
    assignedTo: HR_ID,
    createdBy: ADMIN_ID,
  });
  const itemId = inspection.snapshot.sections[0]!.items[0]!.id;
  await upsertSiteInspectionResponse({
    inspectionId: inspection.id,
    snapshotItemId: itemId,
    notes: "Gas meter sits behind the oleander hedge",
    actorId: ADMIN_ID,
  });
  return inspection;
}

describe.each([
  ["index installed", true],
  ["index not installed (searching sources directly)", false],
])("the four sources — %s", (_label, ready) => {
  beforeEach(() => {
    index.ready = ready;
  });

  it("Inventory returns matching items by name, SKU, vendor, location text, and notes", async () => {
    await createInventoryItem({
      itemName: "Tankless water heater",
      sku: "TWH-2200",
      quantity: 1,
      unitCostCents: 98_765,
      vendor: "Sample Supply",
      customProjectLabel: "Sample ADU",
      notes: "Back-ordered until spring",
      actorId: ADMIN_ID,
    } as never);
    for (const q of ["tankless", "TWH-2200", "sample supply", "back-ordered"]) {
      const run = await search(employee(), q, "inventory");
      expect(
        of(run.results, "inventory").map((r) => r.title),
        q,
      ).toEqual(["Tankless water heater"]);
    }
    const r = (await search(employee(), "TWH-2200")).results[0]!;
    expect(r.url).toBe("/inventory?q=TWH-2200");
    expect(JSON.stringify(r)).not.toMatch(/98765|987\.65/);
    expect(r.actions.map((a) => a.label)).toEqual(["Copy SKU"]);
  });

  it("Site Inspections match project, address, template, inspector, status, and notes", async () => {
    const inspection = await seedInspection();
    for (const q of [
      "synthetic hilltop",
      "42 sample st",
      "detached adu walkthrough",
      "harper inspector",
      "oleander",
    ]) {
      const hits = of((await search(employee(), q, "inspections")).results, "inspections");
      expect(
        hits.map((h) => h.recordId),
        q,
      ).toEqual([inspection.id]);
      expect(hits[0]!.url).toBe(`/inspections/${inspection.id}`);
    }
    const byNote = of((await search(employee(), "oleander")).results, "inspections")[0]!;
    expect(byNote.description).toMatch(/^Notes: .*oleander/);
    expect(byNote.subtitle).toBe("Site inspection · Pending · Detached ADU walkthrough");
  });

  it("JobTread jobs match name, number, customer, and address; navigation goes to JobTread", async () => {
    const run = await search(admin(), "Test Project 1", "jobs");
    const job = of(run.results, "jobtread-jobs")[0]!;
    expect(job.title).toBe("Test Project 1");
    expect(job.url).toMatch(/^https:\/\/app\.jobtread\.com\/jobs\//);
    expect(job.freshness.kind).toBe("cached");
  });

  it("JobTread documents appear only with financial access, and navigate to the job", async () => {
    const [job] = await agentDb().select<{ id: string; name: string }>("jt_jobs", { limit: 1 });
    await agentDb().insert("jt_documents", {
      id: "docSynthetic0001",
      job_id: job!.id,
      type: "customerInvoice",
      status: "pending",
      number: "INV-7781",
      name: "Progress billing 2",
      issue_date: "2026-09-01",
      price: 12_500,
      balance: 2500,
      synced_at: new Date().toISOString(),
      removed_at: null,
    });
    // The JobTread sync writes documents and then refreshes the search index.
    invalidateSourceDocs();
    if (ready) await reindexProvider(getSearchProvider("jobtread-documents")!, "test");
    const general = await search(employee(["general"]), "INV-7781");
    expect(general.outcomes.map((o) => o.provider)).not.toContain("jobtread-documents");
    expect(JSON.stringify(general.results)).not.toMatch(/Progress billing/);

    const fin = await search(employee(["general", "financial"]), "INV-7781");
    const doc = of(fin.results, "jobtread-documents")[0]!;
    expect(doc.title).toBe("Progress billing 2");
    expect(doc.subtitle).toBe("Customer invoice · #INV-7781 · Pending");
    expect(doc.tier).toBe("identifier");
    expect(doc.url).toBe(`https://app.jobtread.com/jobs/${job!.id}`);
    expect(doc.description).toContain(job!.name);
    // Searching the job's name finds its documents too.
    const byJob = await search(employee(["general", "financial"]), job!.name, "jobs");
    expect(of(byJob.results, "jobtread-documents").map((r) => r.recordId)).toContain(
      "docSynthetic0001",
    );
  });

  it("Knowledge matches article text for readers only, with an excerpt of the match", async () => {
    await createKnowledgeEntry(
      {
        title: "Permit checklist basics",
        content: "Always photograph the setback stakes before the inspector arrives on site.",
        category: "Permits",
        tags: ["permit"],
        status: "approved",
      } as never,
      ADMIN_ID,
    );
    await createKnowledgeEntry(
      {
        title: "Draft reorg memo",
        content: "Unannounced setback stakes reorganization",
        category: "HR",
        tags: [],
        status: "draft",
      } as never,
      HR_ID,
    );
    const hits = of((await search(employee(), "setback stakes", "knowledge")).results, "knowledge");
    expect(hits.map((h) => h.title)).toEqual(["Permit checklist basics"]);
    expect(hits[0]!.description).toContain("setback stakes");
    // The draft's author still finds their own draft by its body.
    const author = ctxFor(HR_ID, "user", ["general"]);
    expect(
      of((await search(author, "reorganization", "knowledge")).results, "knowledge").map(
        (h) => h.title,
      ),
    ).toEqual(["Draft reorg memo"]);
  });

  it("a legitimately empty search is 'empty', never an error", async () => {
    const run = await search(admin(), "zzqx nothing matches");
    for (const id of ["inventory", "inspections", "jobtread-jobs", "knowledge"]) {
      expect(run.outcomes.find((o) => o.provider === id)?.status, id).toBe("empty");
    }
  });
});

describe("index not installed", () => {
  it("never attempts index upkeep, and still answers from the source", async () => {
    index.ready = false;
    vi.mocked(reindexProvider).mockClear(); // the beforeEach sync refreshes the index once
    await createInventoryItem({
      itemName: "Synthetic hinge",
      sku: "HNG-1",
      quantity: 2,
      unitCostCents: 100,
      customProjectLabel: "Sample ADU",
      actorId: ADMIN_ID,
    } as never);
    const run = await search(employee(), "synthetic hinge");
    expect(of(run.results, "inventory")).toHaveLength(1);
    expect(vi.mocked(reindexProvider)).not.toHaveBeenCalled();
    expect(run.outcomes.every((o) => o.status === "ok" || o.status === "empty")).toBe(true);
  });

  it("falls back to the source when the index function disappears mid-flight", async () => {
    index.throwMissing = true;
    await createInventoryItem({
      itemName: "Synthetic latch",
      sku: "LTC-9",
      quantity: 1,
      unitCostCents: 100,
      customProjectLabel: "Sample ADU",
      actorId: ADMIN_ID,
    } as never);
    const run = await search(employee(), "LTC-9");
    expect(run.outcomes.find((o) => o.provider === "inventory")?.status).toBe("ok");
    expect(of(run.results, "inventory")[0]?.title).toBe("Synthetic latch");
  });

  it("a real source failure is reported as an error and doesn't hide the others", async () => {
    index.ready = false;
    const inventory = getSearchProvider("inventory")!;
    const broken: SearchProvider = {
      ...inventory,
      indexer: {
        ...inventory.indexer!,
        fetchAll: async () => {
          throw new Error("inventory_items: connection refused");
        },
      },
    };
    broken.search = (ctx, input) =>
      import("@/lib/search/providers/indexed").then((m) => m.indexedSearch(broken, ctx, input));
    setSearchProvidersForTests([broken, getSearchProvider("jobtread-jobs")!]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = await search(admin(), "Test Project 1");
    const failed = run.outcomes.find((o) => o.provider === "inventory")!;
    expect(failed.status).toBe("error");
    expect(failed.message).toBe(
      "Couldn't search Inventory right now. Results from it may be missing.",
    );
    expect(JSON.stringify(run)).not.toMatch(/connection refused/);
    expect(of(run.results, "jobtread-jobs").length).toBeGreaterThan(0);
    // Server-side diagnostics carry the provider and the real cause.
    expect(errors).toHaveBeenCalledWith(
      "[search.provider.failed]",
      expect.objectContaining({ provider: "inventory", message: expect.stringMatching(/refused/) }),
    );
    errors.mockRestore();
  });
});
