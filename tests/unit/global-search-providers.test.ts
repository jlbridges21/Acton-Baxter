/**
 * Global Search providers, authorization, index lifecycle, and reliability.
 * In-memory stores, the synthetic JobTread fixture, and mocked CRM/HR connectors —
 * nothing external is called and no real records are used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- GoHighLevel + BambooHR are mocked at the module boundary (no network) ---------------
const ghl = vi.hoisted(() => ({
  enabled: true,
  configured: true,
  searchContacts: vi.fn(),
  getContactsByIds: vi.fn(),
  searchOpportunities: vi.fn(),
}));
vi.mock("@/lib/connectors/ghl/config", () => ({
  isGhlEnabled: () => ghl.enabled,
  isGhlConfigured: () => ghl.configured,
}));
vi.mock("@/lib/connectors/ghl/resources/contacts", () => ({
  searchContacts: ghl.searchContacts,
  getContactsByIds: ghl.getContactsByIds,
}));
vi.mock("@/lib/connectors/ghl/resources/opportunities", () => ({
  searchOpportunities: ghl.searchOpportunities,
}));
const bamboo = vi.hoisted(() => ({ status: "connected" as string, listEmployees: vi.fn() }));
vi.mock("@/lib/bamboohr/connection", () => ({
  getConnection: async () => ({ status: bamboo.status }),
}));
vi.mock("@/lib/bamboohr/service", () => ({ listEmployees: bamboo.listEmployees }));

import { createAgent } from "@/lib/agents/admin";
import { SAM_DEFAULT_CONFIG } from "@/lib/agents/defaults";
import { agentDb, eq } from "@/lib/agents/store";
import { getResolvedAgent, invalidateAgentRegistry } from "@/lib/agents/registry";
import {
  createInventoryItem,
  resetInventoryMemoryForTests,
  softDeleteInventoryItem,
} from "@/lib/inventory/store";
import {
  createKnowledgeEntry,
  resetKnowledgeMemoryForTests,
  setKnowledgeEntryStatus,
} from "@/lib/knowledge/store";
import { NAV_ENTRIES, type NavEntry } from "@/lib/navigation/registry";
import { getOpsAccess, resetOpsOrgForTests, setDecision } from "@/lib/ops/org";
import { runFullSync } from "@/lib/jobtread/sync";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { createGroup } from "@/lib/reports/groups";
import { createReport, resetReportTemplatesForTests, updateReportMeta } from "@/lib/reports/repo";
import { reportSpecSchema } from "@/lib/reports/spec";
import { getReportsAccess } from "@/lib/reports/access";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { runSearchAdminCommand } from "@/lib/search/admin";
import { createSearchContextFor, type SearchContext } from "@/lib/search/context";
import { searchAll, runSearch } from "@/lib/search/engine";
import { buildSearchHome, recordUse } from "@/lib/search/home";
import { reindexProvider, toIndexRow } from "@/lib/search/index-store";
import { resetSearchMetricsForTests, latencySummary } from "@/lib/search/metrics";
import type { SearchProvider } from "@/lib/search/provider";
import { getSearchProvider, setSearchProvidersForTests } from "@/lib/search/registry";
import { invalidateSearchSettings, validateFieldSelection } from "@/lib/search/settings";
import type { SearchResult } from "@/lib/search/types";
import { ADMIN_ID, EMPLOYEE_ID, HR_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

const CEO_ID = "00000000-0000-4000-8000-0000000000b1";

function ctxFor(id: string, role: string, label = "Tester"): SearchContext {
  return createSearchContextFor(
    { id, email: `${id}@example.test`, role, label },
    requester(id, role, label),
  );
}
const admin = () => ctxFor(ADMIN_ID, "admin", "Avery Admin");
const employee = () => ctxFor(EMPLOYEE_ID, "user", "Eli Employee");
const coworker = () => ctxFor(HR_ID, "user", "Harper HR");

async function search(
  ctx: SearchContext,
  query: string,
  category: SearchResult["category"] | null = null,
  limit = 25,
) {
  return searchAll(ctx, { query, category, limit, offset: 0 });
}
const titles = (rs: SearchResult[]) => rs.map((r) => r.title);
const inCat = (rs: SearchResult[], c: SearchResult["category"]) =>
  rs.filter((r) => r.category === c);

const spec = (title: string, source: "jobs" | "commissions" = "jobs") =>
  reportSpecSchema.parse({
    title,
    datasets: [
      source === "commissions"
        ? { id: "c", source, ruleSet: "sales_commissions" }
        : { id: "jobs", source },
    ],
    widgets: [],
  });

beforeEach(async () => {
  await setupAgentTestEnv();
  resetReportTemplatesForTests();
  resetInventoryMemoryForTests();
  resetKnowledgeMemoryForTests();
  resetOpsOrgForTests();
  resetRateLimitsForTests();
  resetSearchMetricsForTests();
  invalidateSearchSettings();
  invalidateFieldCatalog();
  setSearchProvidersForTests(null);
  ghl.enabled = true;
  ghl.configured = true;
  ghl.searchContacts.mockReset();
  ghl.getContactsByIds.mockReset();
  ghl.searchOpportunities.mockReset();
  ghl.searchContacts.mockResolvedValue({
    contacts: [],
    total: 0,
    hasMore: false,
    page: 1,
    pageLimit: 25,
  });
  ghl.searchOpportunities.mockResolvedValue({ opportunities: [], total: 0, hasMore: false });
  bamboo.status = "connected";
  bamboo.listEmployees.mockReset();
  bamboo.listEmployees.mockResolvedValue({
    data: { employees: [], total: 0, nextCursor: null },
    source: {},
  });
  installFakePave();
  await runFullSync("test");
});
afterEach(() => {
  uninstallFakePave();
  setSearchProvidersForTests(null);
});

// ---------------------------------------------------------------------------
describe("tools, pages, and settings (canonical registry)", () => {
  it("finds tools by name, alias, and typo, with the role's own URL", async () => {
    const { results } = await search(employee(), "inventory");
    expect(results.find((r) => r.provider === "tools")?.url).toBe("/inventory");
    const typo = await search(employee(), "invnetory");
    expect(titles(inCat(typo.results, "tools"))).toContain("Inventory");
    const alias = await search(employee(), "zoning");
    expect(titles(alias.results)).toContain("Property Research");
    const kAdmin = await search(admin(), "knowledge center");
    expect(kAdmin.results.find((r) => r.title === "Knowledge Center")?.url).toBe(
      "/admin/knowledge",
    );
    const kUser = await search(employee(), "knowledge center");
    expect(kUser.results.find((r) => r.title === "Knowledge Center")?.url).toBe("/knowledge");
  });

  it("never returns admin pages to employees", async () => {
    const asEmployee = await search(employee(), "users");
    expect(asEmployee.results.some((r) => r.url === "/admin/users")).toBe(false);
    const asAdmin = await search(admin(), "users");
    expect(asAdmin.results.some((r) => r.url === "/admin/users")).toBe(true);
    const gs = await search(employee(), "global search");
    expect(gs.results.some((r) => r.url === "/admin/search")).toBe(false);
  });

  it("'BambooHR' shows only the BambooHR pages the viewer is authorized for", async () => {
    const asEmployee = await search(employee(), "bamboohr");
    const urls = asEmployee.results.map((r) => r.url);
    expect(urls).toContain("/ai/operations");
    expect(urls).not.toContain("/ai/operations?tab=integrations");
    expect(urls).not.toContain("/ai/operations?tab=employees");

    const adminOps = await getOpsAccess(requester(ADMIN_ID, "admin"));
    await setDecision({
      key: "ceo_account",
      status: "confirmed",
      value: CEO_ID,
      access: adminOps,
      actorLabel: "Admin",
    });
    const ceoOps = await getOpsAccess(requester(CEO_ID, "user"));
    await setDecision({
      key: "hr_admins",
      status: "confirmed",
      value: [HR_ID],
      access: ceoOps,
      actorLabel: "CEO",
    });
    const asHr = await search(coworker(), "bamboohr");
    const hrUrls = asHr.results.map((r) => r.url);
    expect(hrUrls).toContain("/ai/operations?tab=integrations");
    expect(hrUrls).toContain("/ai/operations?tab=employees");
  });

  it("picks up a new registry page with no search code change", async () => {
    const entry: NavEntry = {
      id: "test-permit-board",
      label: "Permit Board",
      href: "/permit-board",
      icon: "table",
      kind: "page",
      description: "Synthetic test page.",
      audience: "all",
    };
    NAV_ENTRIES.push(entry);
    try {
      const { results } = await search(employee(), "permit board");
      expect(results[0]?.url).toBe("/permit-board");
      expect(results[0]?.tier).toBe("exact");
    } finally {
      NAV_ENTRIES.splice(NAV_ENTRIES.indexOf(entry), 1);
    }
  });
});

// ---------------------------------------------------------------------------
describe("AI agents (Agent Registry)", () => {
  it("returns published agents with status and chat action; picks up a new agent automatically", async () => {
    const dexter = await search(employee(), "dexter", "agents");
    const card = dexter.results.find((r) => r.recordId === "dexter");
    expect(card?.url).toBe("/ai/agents/dexter");
    expect(card?.preview.find((p) => p.label === "Status")).toBeTruthy();
    expect(
      card?.actions.some((a) => a.kind === "open" && a.href === "/ai/agents/dexter?tab=chat"),
    ).toBe(true);

    expect((await search(employee(), "olivia", "agents")).results).toHaveLength(0);
    const baxter = (await getResolvedAgent("baxter"))!;
    await createAgent({
      displayName: "Olivia",
      title: "Permitting Coordinator",
      description: "Tracks permit submissions.",
      departmentId: null,
      managerAgentId: baxter.row.id,
      config: SAM_DEFAULT_CONFIG,
      activate: true,
      actor: { userId: ADMIN_ID, label: "Avery Admin" },
    });
    const after = await search(employee(), "olivia", "agents");
    expect(after.results[0]?.title).toBe("Olivia");
    expect(after.results[0]?.subtitle).toContain("Permitting Coordinator");
  });

  it("hides draft agents from employees but shows them to admins", async () => {
    await createAgent({
      displayName: "Quinn Draft",
      title: "Draft helper",
      description: "Not live yet.",
      departmentId: null,
      managerAgentId: null,
      config: SAM_DEFAULT_CONFIG,
      activate: false,
      actor: { userId: ADMIN_ID, label: "Avery Admin" },
    });
    invalidateAgentRegistry();
    expect((await search(employee(), "quinn draft", "agents")).results).toHaveLength(0);
    const a = await search(admin(), "quinn draft", "agents");
    expect(a.results[0]?.preview.find((p) => p.label === "Status")?.value).toMatch(/draft/i);
  });
});

// ---------------------------------------------------------------------------
describe("Dexter reports and groups", () => {
  it("finds a new report immediately, never another user's private report", async () => {
    const mine = await createReport({
      spec: spec("Permit velocity tracker"),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
    });
    const owner = await search(employee(), "permit velocity", "reports");
    expect(owner.results[0]?.url).toBe(`/reports/${mine.id}`);
    expect(owner.results[0]?.subtitle).toContain("Yours");
    expect((await search(coworker(), "permit velocity")).results.map((r) => r.id)).not.toContain(
      `reports:${mine.id}`,
    );
    expect((await search(admin(), "permit velocity", "reports")).results).toHaveLength(1);

    await updateReportMeta(mine, { visibility: "company" });
    expect((await search(coworker(), "permit velocity", "reports")).results).toHaveLength(1);
  });

  it("does not reveal a private financial report's title or count to others", async () => {
    await createReport({
      spec: spec("Owner margin secrets", "commissions"),
      ownerId: ADMIN_ID,
      authorKind: "user",
    });
    const run = await search(employee(), "owner margin secrets");
    expect(run.results.some((r) => /margin secrets/i.test(r.title))).toBe(false);
    const outcome = run.outcomes.find((o) => o.provider === "reports");
    expect(outcome?.count).toBe(0);
  });

  it("finds report groups, but not another user's personal group", async () => {
    const access = await getReportsAccess(requester(HR_ID, "user"));
    const g = await createGroup({
      requester: requester(HR_ID, "user"),
      access,
      actorLabel: "Harper",
      name: "Harper private folder",
    });
    expect((await search(employee(), "harper private folder")).results).toHaveLength(0);
    const own = await search(coworker(), "harper private folder", "reports");
    expect(own.results[0]?.url).toBe(`/reports?group=${g.id}`);
  });

  it("users without Reports access get no reports or jobs category at all", async () => {
    const noReports = createSearchContextFor(
      { id: EMPLOYEE_ID, email: "e@example.test", role: "user", label: "Eli" },
      requester(EMPLOYEE_ID, "user"),
      { reportsAccess: async () => null },
    );
    const run = await search(noReports, "test project");
    expect(
      run.outcomes.some((o) => o.provider === "reports" || o.provider === "jobtread-jobs"),
    ).toBe(false);
    const home = await buildSearchHome(noReports);
    expect(home.categories.map((c) => c.id)).not.toContain("jobs");
    expect(home.categories.map((c) => c.id)).not.toContain("reports");
  });
});

// ---------------------------------------------------------------------------
describe("JobTread jobs (indexed cache)", () => {
  it("finds jobs by name, exact number, partial address, and mapped fields with cached freshness", async () => {
    const byName = await search(employee(), "Test Project 3", "jobs");
    expect(byName.results[0]?.title).toBe("Test Project 3");
    expect(byName.results[0]?.tier).toBe("exact");
    expect(byName.results[0]?.freshness.kind).toBe("cached");
    expect(byName.results[0]?.sourceLabel).toBe("JobTread");
    expect(byName.results[0]?.url).toBe("https://app.jobtread.com/jobs/job00000003");
    expect(byName.results[0]?.external).toBe(true);

    const byNumber = await search(employee(), "1003", "jobs");
    expect(byNumber.results[0]?.title).toBe("Test Project 3");
    expect(byNumber.results[0]?.tier).toBe("identifier");

    const byAddress = await search(employee(), "3 test street", "jobs");
    expect(byAddress.results[0]?.title).toBe("Test Project 3");
    expect(byAddress.results[0]?.tier).toBe("address");

    const byModel = await search(employee(), "998-B-1", "jobs");
    expect(titles(byModel.results)).toContain("Test Project 3");
  });

  it("never matches customer-only or internal custom fields for a general-access employee", async () => {
    // Spouse name and sales strategy live in non-general fields.
    expect((await search(employee(), "Price sensitive", "jobs")).results).toHaveLength(0);
    expect(
      (await search(employee(), "Pat", "jobs")).results.filter((r) => r.title === "Test Project 1"),
    ).toHaveLength(0);
    const r = (await search(employee(), "Test Project 1", "jobs")).results[0]!;
    expect(JSON.stringify(r)).not.toMatch(/300000|210000|Price sensitive|Pat\b/);
  });

  it("drops removed jobs and records the removal on reindex", async () => {
    expect((await search(employee(), "Test Project 3", "jobs")).results[0]?.title).toBe(
      "Test Project 3",
    );
    await agentDb().update("jt_jobs", [eq("id", "job00000003")], {
      removed_at: new Date().toISOString(),
    });
    // Index still has the row (stale), but lookup re-reads the source of truth.
    expect(
      (await search(employee(), "Test Project 3", "jobs")).results.map((r) => r.title),
    ).not.toContain("Test Project 3");
    const r = await reindexProvider(getSearchProvider("jobtread-jobs")!, "test");
    expect(r.status).toBe("succeeded");
    expect(r.removed).toBe(1);
  });

  it("purges the index when JobTread disconnects", async () => {
    await search(employee(), "Test Project", "jobs");
    expect(
      (
        await agentDb().select("global_search_index", {
          filters: [eq("provider", "jobtread-jobs")],
        })
      ).length,
    ).toBeGreaterThan(0);
    uninstallFakePave();
    const r = await reindexProvider(getSearchProvider("jobtread-jobs")!, "test");
    expect(r.status).toBe("unavailable");
    expect(
      await agentDb().select("global_search_index", { filters: [eq("provider", "jobtread-jobs")] }),
    ).toHaveLength(0);
    const run = await search(employee(), "Test Project", "jobs");
    const outcome = run.outcomes.find((o) => o.provider === "jobtread-jobs");
    expect(outcome?.status).toBe("unavailable");
    expect(outcome?.message).toMatch(/isn't connected/);
    installFakePave();
  });
});

// ---------------------------------------------------------------------------
describe("knowledge, inventory, inspections (indexed internal data)", () => {
  it("knowledge drafts are visible only to the author and admins; no titles leak", async () => {
    const draft = await createKnowledgeEntry(
      {
        title: "Confidential layoff plan",
        content: "body text never indexed",
        category: "HR",
        tags: [],
        status: "draft",
      } as never,
      HR_ID,
    );
    const approved = await createKnowledgeEntry(
      {
        title: "Permit checklist basics",
        content: "x",
        category: "Permits",
        tags: ["permit"],
        status: "approved",
      } as never,
      ADMIN_ID,
    );
    const asEmployee = await search(employee(), "confidential layoff");
    expect(JSON.stringify(asEmployee.results)).not.toMatch(/layoff/i);
    expect(
      (await search(coworker(), "confidential layoff", "knowledge")).results[0]?.recordId,
    ).toBe(draft.id);
    expect((await search(admin(), "confidential layoff", "knowledge")).results[0]?.url).toBe(
      `/admin/knowledge/${draft.id}`,
    );
    expect((await search(employee(), "permit checklist", "knowledge")).results[0]?.url).toBe(
      `/knowledge/${approved.id}`,
    );
    // Body text is not searchable.
    expect((await search(coworker(), "never indexed", "knowledge")).results).toHaveLength(0);
  });

  it("removing access (archiving) hides an entry immediately, before any reindex", async () => {
    const e = await createKnowledgeEntry(
      {
        title: "Window install guide",
        content: "x",
        category: "Field",
        tags: [],
        status: "approved",
      } as never,
      ADMIN_ID,
    );
    expect((await search(employee(), "window install", "knowledge")).results).toHaveLength(1);
    await setKnowledgeEntryStatus(e.id, "archived", ADMIN_ID);
    expect((await search(employee(), "window install", "knowledge")).results).toHaveLength(0);
  });

  it("finds inventory by SKU and name, without costs, and drops deleted items", async () => {
    const item = await createInventoryItem({
      itemName: "Tankless water heater",
      sku: "TWH-2200",
      quantity: 1,
      unitCostCents: 123456,
      vendor: "Sample Supply",
      customProjectLabel: "Sample ADU",
      actorId: ADMIN_ID,
    });
    const bySku = await search(employee(), "TWH-2200", "inventory");
    expect(bySku.results[0]?.tier).toBe("identifier");
    expect(bySku.results[0]?.url).toBe("/inventory?q=TWH-2200");
    expect(JSON.stringify(bySku.results)).not.toMatch(/1234|123456/);
    await softDeleteInventoryItem(item.id, ADMIN_ID);
    expect((await search(employee(), "tankless water heater", "inventory")).results).toHaveLength(
      0,
    );
  });

  it("a manually planted unauthorized index row is never returned", async () => {
    const provider = getSearchProvider("knowledge")!;
    await agentDb().insert(
      "global_search_index",
      toIndexRow(
        provider,
        {
          recordId: "00000000-0000-4000-8000-00000000dead",
          title: "Planted secret board minutes",
          searchText: "planted secret",
          url: "/knowledge/x",
          aclRoles: ["admin", "super_admin"],
        },
        new Date().toISOString(),
      ),
    );
    await agentDb().upsert(
      "global_search_providers",
      {
        provider: "knowledge",
        last_indexed_at: new Date().toISOString(),
        last_index_status: "succeeded",
      },
      ["provider"],
    );
    invalidateSearchSettings();
    const run = await search(employee(), "planted secret");
    expect(JSON.stringify(run.results)).not.toMatch(/planted/i);
    // Even for an admin, a row whose source record doesn't exist is dropped by lookup.
    expect((await search(admin(), "planted secret")).results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("GoHighLevel (live) and BambooHR (live, HR-only)", () => {
  const contact = (over: Record<string, unknown> = {}) => ({
    id: "ghlContact001",
    locationId: "loc",
    firstName: "Jordan",
    lastName: "Sample",
    name: "Jordan Sample",
    email: "jordan@example.test",
    phone: "+1 555 010 0199",
    companyName: "Sample Homes",
    address1: "123 North Main Street",
    city: "Fresno",
    state: "CA",
    postalCode: "93701",
    country: "US",
    source: null,
    tags: [],
    customFields: { secret: "SSN 000-00-0000" },
    dateAdded: null,
    dateUpdated: null,
    dnd: false,
    assignedTo: null,
    ...over,
  });

  it("maps contacts to Customer Center with copy actions and no custom fields", async () => {
    ghl.searchContacts.mockResolvedValue({
      contacts: [contact(), contact({ id: "bad id!" })],
      total: 2,
      hasMore: false,
      page: 1,
      pageLimit: 25,
    });
    const run = await search(employee(), "jordan", "customers");
    expect(run.results).toHaveLength(1); // invalid id dropped, never guessed
    const r = run.results[0]!;
    expect(r.url).toBe("/customers/lookup?contactId=ghlContact001");
    expect(r.actions.map((a) => a.label)).toEqual(["Copy email", "Copy phone"]);
    expect(JSON.stringify(r)).not.toMatch(/SSN|000-00/);
    expect(r.sourceLabel).toBe("GoHighLevel");
    expect(r.freshness.kind).toBe("live");
  });

  it("sends address searches as house number + street and ranks normalized matches", async () => {
    ghl.searchContacts.mockResolvedValue({
      contacts: [contact()],
      total: 1,
      hasMore: false,
      page: 1,
      pageLimit: 25,
    });
    const run = await search(employee(), "123 Main St", "customers");
    // GoHighLevel rejects address-field filters, so the free-text query is used.
    const call = ghl.searchContacts.mock.calls[0]![0] as { query?: string; filters?: unknown };
    expect(call.query).toBe("123 Main");
    expect(call.filters).toBeUndefined();
    expect(run.results[0]?.tier).toBe("address");
  });

  it("groups the same address across sources without merging records", async () => {
    ghl.searchContacts.mockResolvedValue({
      contacts: [contact({ address1: "3 Test Street", city: "Testville", postalCode: "90000" })],
      total: 1,
      hasMore: false,
      page: 1,
      pageLimit: 25,
    });
    const run = await search(employee(), "3 Test St");
    const group = run.done?.addressGroups.find((g) => g.sources.includes("GoHighLevel"));
    expect(group?.sources.sort()).toEqual(["GoHighLevel", "JobTread"]);
    expect(group?.resultIds.length).toBe(2);
    // Different city → never grouped together.
    expect(
      run.done?.addressGroups.every((g) =>
        g.resultIds.every((id) => run.results.some((r) => r.id === id)),
      ),
    ).toBe(true);
  });

  it("reports GoHighLevel as unavailable (not 'no results') when disconnected", async () => {
    ghl.configured = false;
    const run = await search(employee(), "jordan");
    const o = run.outcomes.find((x) => x.provider === "ghl-contacts");
    expect(o?.status).toBe("unavailable");
    expect(ghl.searchContacts).not.toHaveBeenCalled();
  });

  it("BambooHR employees: invisible to regular employees, audited for HR", async () => {
    bamboo.listEmployees.mockResolvedValue({
      data: {
        employees: [
          {
            id: "42",
            name: "Riley Example",
            jobTitle: "Site Supervisor",
            status: "Active",
            restricted: [],
          },
        ],
        total: 1,
        nextCursor: null,
      },
      source: {},
    });
    const asEmployee = await search(employee(), "riley");
    expect(asEmployee.outcomes.some((o) => o.provider === "bamboohr-employees")).toBe(false);
    expect(bamboo.listEmployees).not.toHaveBeenCalled();

    const adminOps = await getOpsAccess(requester(ADMIN_ID, "admin"));
    await setDecision({
      key: "ceo_account",
      status: "confirmed",
      value: CEO_ID,
      access: adminOps,
      actorLabel: "Admin",
    });
    const ceoOps = await getOpsAccess(requester(CEO_ID, "user"));
    await setDecision({
      key: "hr_admins",
      status: "confirmed",
      value: [HR_ID],
      access: ceoOps,
      actorLabel: "CEO",
    });
    const asHr = await search(coworker(), "riley", "employees");
    expect(asHr.results[0]?.url).toBe("/ai/operations?tab=employees&employee=42");
    expect(asHr.results[0]?.subtitle).toBe("Site Supervisor · Active");
    const audit = await agentDb().select<{ action: string }>("ai_audit_log", {
      filters: [eq("action", "search.bamboohr")],
    });
    expect(audit.length).toBeGreaterThan(0);
  });

  it("admins can never make restricted fields searchable", async () => {
    const p = getSearchProvider("bamboohr-employees")!;
    expect(() => validateFieldSelection(p, ["name", "compensation"])).toThrow(
      /can't be made searchable/,
    );
    await expect(
      runSearchAdminCommand(admin(), {
        op: "set_fields",
        provider: "ghl-contacts",
        fields: ["customFields"],
      }),
    ).rejects.toThrow(/can't be made searchable/);
  });
});

// ---------------------------------------------------------------------------
describe("reliability", () => {
  const fake = (over: Partial<SearchProvider>): SearchProvider => ({
    id: "fake",
    category: "tools",
    name: "Fake",
    icon: "search",
    sourceSystem: "baxter",
    description: "",
    searchableFields: [],
    optional: false,
    indexing: "registry",
    permissionSummary: "",
    minQueryLength: 1,
    timeoutMs: 200,
    canUse: async () => true,
    availability: async () => ({ available: true }),
    search: async () => ({ hits: [] }),
    ...over,
  });
  const hit = (title: string) => ({
    recordId: title.toLowerCase().replace(/\W/g, "-"),
    title,
    url: `/x/${title.length}`,
    auth: "internal" as const,
    match: { title },
  });

  it("a slow provider times out without blocking others, and results stream as they arrive", async () => {
    setSearchProvidersForTests([
      fake({
        id: "slow",
        category: "customers",
        timeoutMs: 80,
        search: () => new Promise(() => undefined),
      }),
      fake({ id: "fast", search: async () => ({ hits: [hit("Alpha tool")] }) }),
      fake({
        id: "broken",
        category: "jobs",
        search: async () => {
          throw new Error("db password=hunter2 exploded");
        },
      }),
    ]);
    const order: string[] = [];
    for await (const e of runSearch(
      employee(),
      { query: "alpha", limit: 5, offset: 0 },
      new AbortController().signal,
    )) {
      if (e.type === "provider") order.push(`${e.outcome.provider}:${e.outcome.status}`);
    }
    expect(order[0]).toBe("fast:ok");
    expect(order).toContain("slow:timeout");
    expect(order).toContain("broken:error");
    const run = await search(employee(), "alpha");
    const broken = run.outcomes.find((o) => o.provider === "broken")!;
    expect(broken.message).not.toMatch(/hunter2|password/);
    expect(run.results.map((r) => r.title)).toEqual(["Alpha tool"]);
    expect(latencySummary().providers.slow?.timeouts).toBeGreaterThan(0);
  });

  it("drops unsafe URLs and strips markup from provider output", async () => {
    setSearchProvidersForTests([
      fake({
        search: async () => ({
          hits: [
            { ...hit("Alpha evil"), url: "javascript:alert(1)" },
            { ...hit("Alpha offsite"), url: "https://evil.example/x" },
            {
              ...hit("Alpha <b>bold</b>"),
              match: { title: "Alpha bold" },
              description: "<img src=x onerror=alert(1)>Hello",
            },
          ],
        }),
      }),
    ]);
    const run = await search(employee(), "alpha");
    expect(run.results).toHaveLength(1);
    expect(run.results[0]!.title).toBe("Alpha bold");
    expect(run.results[0]!.description).toBe("Hello");
  });

  it("rate limits external sources per user", async () => {
    ghl.searchContacts.mockResolvedValue({
      contacts: [],
      total: 0,
      hasMore: false,
      page: 1,
      pageLimit: 25,
    });
    let limited = false;
    for (let i = 0; i < 45 && !limited; i++) {
      const run = await search(employee(), `jo${i}`, "customers");
      limited = run.outcomes.some(
        (o) => o.provider === "ghl-contacts" && o.status === "rate_limited",
      );
    }
    expect(limited).toBe(true);
  });

  it("rejects oversized queries", async () => {
    await expect(search(employee(), "x".repeat(121))).rejects.toThrow(/limited to 120/);
  });

  it("reports skipped providers when the query is too short", async () => {
    const run = await search(employee(), "j");
    expect(run.outcomes.find((o) => o.provider === "ghl-contacts")?.status).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
describe("recents and the empty state", () => {
  it("records uses, re-authorizes on read, and never leaks across users", async () => {
    const r = await createReport({
      spec: spec("Site walk follow-ups"),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
    });
    expect((await recordUse(employee(), { provider: "reports", recordId: r.id })).stored).toBe(
      true,
    );
    expect((await recordUse(employee(), { provider: "tools", recordId: "inventory" })).stored).toBe(
      true,
    );
    // Another user's private report can't be recorded by someone who can't see it.
    expect((await recordUse(coworker(), { provider: "reports", recordId: r.id })).stored).toBe(
      false,
    );

    const home = await buildSearchHome(employee());
    expect(home.recent.map((x) => x.title)).toEqual(
      expect.arrayContaining(["Site walk follow-ups", "Inventory"]),
    );
    expect(home.frequentTools[0]?.title).toBe("Inventory");
    expect(home.agents.length).toBeGreaterThan(0);
    expect(home.categories.map((c) => c.id)).toEqual(
      expect.arrayContaining(["tools", "agents", "reports", "jobs"]),
    );

    const other = await buildSearchHome(coworker());
    expect(other.recent.map((x) => x.title)).not.toContain("Site walk follow-ups");

    // Once the record is gone, it disappears from recents too.
    await agentDb().remove("bi_reports", [eq("id", r.id)]);
    expect((await buildSearchHome(employee())).recent.map((x) => x.title)).not.toContain(
      "Site walk follow-ups",
    );
  });

  it("hides categories whose provider is unavailable and categories an admin disabled", async () => {
    ghl.configured = false;
    expect((await buildSearchHome(employee())).categories.map((c) => c.id)).not.toContain(
      "customers",
    );
    ghl.configured = true;
    expect((await buildSearchHome(employee())).categories.map((c) => c.id)).toContain("customers");
    await runSearchAdminCommand(admin(), {
      op: "set_enabled",
      provider: "ghl-contacts",
      enabled: false,
    });
    expect((await buildSearchHome(employee())).categories.map((c) => c.id)).not.toContain(
      "customers",
    );
    await expect(
      runSearchAdminCommand(admin(), { op: "set_enabled", provider: "tools", enabled: false }),
    ).rejects.toThrow(/core provider/);
  });

  it("disabling an indexed provider purges its rows; synonyms apply to search", async () => {
    await search(employee(), "Test Project", "jobs");
    await runSearchAdminCommand(admin(), {
      op: "set_enabled",
      provider: "jobtread-jobs",
      enabled: false,
    });
    expect(
      await agentDb().select("global_search_index", { filters: [eq("provider", "jobtread-jobs")] }),
    ).toHaveLength(0);
    await runSearchAdminCommand(admin(), {
      op: "upsert_synonym",
      term: "warehouse",
      synonyms: ["inventory"],
    });
    const run = await search(employee(), "warehouse");
    expect(titles(run.results)).toContain("Inventory");
  });
});
