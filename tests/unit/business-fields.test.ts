/** Business fields: spreadsheet import, verified matching, admin management, Dexter use. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb, eq } from "@/lib/agents/store";
import { getTool } from "@/lib/agents/tools";
import { REQUESTED_BUSINESS_FIELDS } from "@/lib/jobtread/business-field-requests";
import {
  createBusinessField,
  getBusinessFieldsOverview,
  importRequestedBusinessFields,
  matchRequested,
  reconcileAutoMappings,
  setBusinessFieldArchived,
  slugKey,
  updateBusinessField,
} from "@/lib/jobtread/business-fields";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { F } from "@/lib/jobtread/fixture";
import type { CustomFieldRow } from "@/lib/jobtread/metadata";
import { runFullSync } from "@/lib/jobtread/sync";
import { getFieldCatalog, invalidateFieldCatalog, resolveField } from "@/lib/reports/fields";
import { ADMIN_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

vi.setConfig({ testTimeout: 30_000 });

const admin = requester(ADMIN_ID, "admin", "Avery Admin");

const view = async (key: string) =>
  (await getBusinessFieldsOverview()).fields.find((f) => f.key === key)!;

const cf = (over: Partial<CustomFieldRow>): CustomFieldRow => ({
  id: "x",
  name: "Phase",
  type: "option",
  target_type: "job",
  options: [],
  position: null,
  display_name: null,
  description: null,
  category: "general",
  first_seen_at: "",
  last_seen_at: "",
  removed_at: null,
  ...over,
});

beforeEach(async () => {
  await setupAgentTestEnv();
  clearJobDetailCache();
  invalidateFieldCatalog();
  installFakePave();
  await runFullSync("test");
  invalidateFieldCatalog();
});
afterEach(() => uninstallFakePave());

describe("spreadsheet list", () => {
  it("has all 92 requested fields with unique (category, name)", () => {
    expect(REQUESTED_BUSINESS_FIELDS).toHaveLength(92);
    const ids = REQUESTED_BUSINESS_FIELDS.map((r) => `${r.category}|${r.name}`);
    expect(new Set(ids).size).toBe(92);
    expect(REQUESTED_BUSINESS_FIELDS.find((r) => r.name === "Climate Zone")!.options).toContain(
      "Unknown",
    );
  });

  it("matches only on a verified exact name + target + type", () => {
    const req = { category: "Jobs", name: "phase ", type: "Dropdown" };
    expect(matchRequested(req, [cf({ id: "a" })]).status).toBe("exact");
    expect(matchRequested(req, [cf({ id: "a", type: "text" })]).status).toBe("type_mismatch");
    expect(matchRequested(req, [cf({ id: "a", target_type: "location" })]).status).toBe(
      "not_found",
    );
    expect(matchRequested(req, [cf({ id: "a" }), cf({ id: "b" })]).status).toBe("ambiguous");
    expect(matchRequested(req, [cf({ id: "a", name: "Phases" })]).status).toBe("not_found");
    expect(slugKey("Site, Access & Accessibility")).toBe("site_access_and_accessibility");
  });
});

describe("import after sync", () => {
  it("adds every requested field once, links existing ones, and auto-maps exact matches", async () => {
    const o = await getBusinessFieldsOverview();
    expect(o.summary.spreadsheetImported).toBe(92);
    const live = o.fields.filter((f) => !f.archivedAt);
    // No duplicate names.
    const labels = live.map((f) => f.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    // Existing keys reused (reports using sem:phase keep working).
    const phase = live.find((f) => f.key === "phase")!;
    expect(phase).toMatchObject({
      sourceName: "Phase",
      customFieldId: F.phase,
      status: "mapped",
    });
    expect(live.filter((f) => f.customFieldId === F.phase)).toHaveLength(1);
    // Existing "Square Footage" row is the spreadsheet's "Total Sqft" (same JobTread field).
    expect(live.find((f) => f.key === "total_sqft")).toMatchObject({ sourceName: "Total Sqft" });
    // New exact match from the sheet.
    expect(live.find((f) => f.sourceName === "Sales Rep")).toMatchObject({
      customFieldId: F.salesRep,
      mappedBy: "auto",
    });
    // Same name in several categories → distinct labels.
    expect(live.map((f) => f.label)).toEqual(
      expect.arrayContaining(["Email (Customer Contacts)", "Email (Vendor Accounts)"]),
    );
    // Type differs (sheet: Dropdown, JobTread: number) → left for review, not guessed.
    expect(live.find((f) => f.sourceName === "Vendor Rating")).toMatchObject({
      customFieldId: null,
      status: "needs_review",
    });
    expect(live.find((f) => f.sourceName === "Arborist Required")!.status).toBe("not_in_jobtread");
    // Idempotent.
    const again = await importRequestedBusinessFields();
    expect(again.created).toBe(0);
  });

  it("never overrides an administrator's mapping or explicit unmapping", async () => {
    await updateBusinessField("phase", { customFieldId: F.pm }, ADMIN_ID);
    const salesRep = (await getBusinessFieldsOverview()).fields.find(
      (f) => f.sourceName === "Sales Rep",
    )!;
    await updateBusinessField(salesRep.key, { customFieldId: null }, ADMIN_ID);
    await reconcileAutoMappings();
    await importRequestedBusinessFields();
    expect((await view("phase")).customFieldId).toBe(F.pm);
    expect((await view("phase")).mappedBy).toBe("admin");
    const after = await view(salesRep.key);
    expect(after.customFieldId).toBeNull();
    expect(after.issues.join(" ")).toMatch(/administrator left this unmapped/);
  });
});

describe("admin management", () => {
  it("renames without changing the key, archives and restores", async () => {
    await updateBusinessField("phase", { label: "Project Phase" }, ADMIN_ID);
    invalidateFieldCatalog();
    let catalog = await getFieldCatalog();
    expect(resolveField(catalog, "sem:phase")).toMatchObject({ ok: true, key: `cf:${F.phase}` });
    expect(catalog.semantic.get("sem:phase")!.label).toBe("Project Phase");

    await setBusinessFieldArchived("phase", true, ADMIN_ID);
    invalidateFieldCatalog();
    catalog = await getFieldCatalog();
    expect(resolveField(catalog, "sem:phase").ok).toBe(false);
    expect((await view("phase")).status).toBe("archived");
    await setBusinessFieldArchived("phase", false, ADMIN_ID);
    invalidateFieldCatalog();
    expect(resolveField(await getFieldCatalog(), "sem:phase").ok).toBe(true);
  });

  it("adds fields, rejects duplicates, and validates JobTread ids", async () => {
    const row = await createBusinessField(
      { label: "Permit Fees", category: "Jobs", customFieldId: F.budget },
      ADMIN_ID,
    );
    expect(row.key).toBe("permit_fees");
    await expect(createBusinessField({ label: "permit fees" }, ADMIN_ID)).rejects.toThrow(
      /already exists/,
    );
    await expect(
      updateBusinessField("permit_fees", { customFieldId: "cfNoSuch01" }, ADMIN_ID),
    ).rejects.toThrow(/wasn't found/);
  });

  it("flags invalid, mismatched, and non-reportable mappings", async () => {
    await updateBusinessField("phase", { customFieldId: F.electrical }, ADMIN_ID);
    expect((await view("phase")).status).toBe("mismatch");

    const vendor = (await getBusinessFieldsOverview()).fields.find(
      (f) => f.sourceName === "Vendor Rating",
    )!;
    await updateBusinessField(vendor.key, { customFieldId: "cfVendor001" }, ADMIN_ID);
    const v = await view(vendor.key);
    expect(v.status).toBe("mismatch"); // sheet says Dropdown, JobTread says number
    invalidateFieldCatalog();
    // Vendor fields start Excluded; that reason comes first.
    expect(resolveField(await getFieldCatalog(), `sem:${vendor.key}`)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/excluded/),
    });
    await agentDb().update("jt_custom_fields", [eq("id", "cfVendor001")], {
      category: "general",
    });
    invalidateFieldCatalog();
    expect(resolveField(await getFieldCatalog(), `sem:${vendor.key}`)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/vendor field/),
    });

    await agentDb().update("jt_custom_fields", [eq("id", F.pm)], {
      removed_at: new Date().toISOString(),
    });
    const pm = (await getBusinessFieldsOverview()).fields.find(
      (f) => f.customFieldId === F.pm && !f.archivedAt,
    )!;
    expect(pm.status).toBe("invalid");
  });
});

describe("Dexter", () => {
  it("sees newly mapped spreadsheet fields and why others are unavailable", async () => {
    const ctx = {
      task: { id: "00000000-0000-4000-8000-0000000000f1", allowed_context: {} } as never,
      agent: {} as never,
      requester: admin,
      access: new Set<never>(),
    };
    const res = (await getTool("reports_list_fields")!.execute(ctx, { source: "jobs" })).data as {
      businessNames: Array<{ key: string; label: string; available: boolean; note?: string }>;
    };
    const salesRep = res.businessNames.find((b) => b.label === "Sales Rep")!;
    expect(salesRep.available).toBe(true);
    const arborist = res.businessNames.find((b) => b.label === "Arborist Required")!;
    expect(arborist).toMatchObject({ available: false });
    expect(arborist.note).toMatch(/Not mapped/);
  });
});
