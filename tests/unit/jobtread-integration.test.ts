import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDb } from "@/lib/agents/store";
import {
  assertReadOnlyQuery,
  JobTreadError,
  newStats,
  paginate,
  pave,
} from "@/lib/jobtread/client";
import { clearJobDetailCache, getJobDetail } from "@/lib/jobtread/detail";
import {
  defaultCategory,
  listCustomFields,
  listSemanticFields,
  updateSemanticField,
} from "@/lib/jobtread/metadata";
import {
  collectValues,
  maybeEnqueueScheduledJobTreadSync,
  normalizeJob,
  runFullSync,
  testConnection,
} from "@/lib/jobtread/sync";
import { setupAgentTestEnv } from "./agents-test-helpers";
import { F, FAKE_GRANT_KEY, installFakePave, JOBS, uninstallFakePave } from "./jobtread-fixtures";

beforeEach(async () => {
  await setupAgentTestEnv();
  clearJobDetailCache();
});
afterEach(() => {
  uninstallFakePave();
  vi.useRealTimers();
});

describe("read-only guard", () => {
  it("allows read queries, including inputs that mention mutation words as data", () => {
    expect(() =>
      assertReadOnlyQuery({
        organization: {
          $: { id: "x", where: [["name", "=", "createJob"]] },
          jobs: { nodes: { id: {} } },
        },
      }),
    ).not.toThrow();
  });

  it.each([
    [{ createJob: { $: { name: "x" } } }],
    [{ organization: { updateAccount: {} } }],
    [{ deleteFile: { $: { id: "1" } } }],
    [{ sendDocument: {} }],
    [{ signQuery: {} }],
    [{ organization: { innocent: { _: "createCostItem" } } }],
  ])("blocks mutation fields before any network call: %j", async (query) => {
    const fake = installFakePave();
    expect(() => assertReadOnlyQuery(query)).toThrow(JobTreadError);
    await expect(pave(query)).rejects.toMatchObject({ code: "WRITE_BLOCKED" });
    expect(fake.calls).toBe(0);
  });
});

describe("Pave client", () => {
  it("reports NOT_CONFIGURED without a grant key", async () => {
    delete process.env.JOBTREAD_GRANT_KEY;
    await expect(pave({ currentGrant: { id: {} } })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });

  it("puts the grant key only in the request body and never in errors", async () => {
    const fake = installFakePave({ failFirst: [400] });
    const error = await pave({ currentGrant: { id: {} } }).catch(
      (e: unknown) => e as JobTreadError,
    );
    expect(error).toMatchObject({ code: "BAD_QUERY" });
    expect(String((error as Error).message)).not.toContain(FAKE_GRANT_KEY);
    expect(fake.bodies[0]).toContain(FAKE_GRANT_KEY);
  });

  it("maps 401 to AUTH_FAILED without retrying", async () => {
    const fake = installFakePave({ failFirst: [401] });
    await expect(pave({ currentGrant: { id: {} } })).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(fake.calls).toBe(1);
  });

  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    const fake = installFakePave({ failFirst: [429, 503] });
    const stats = newStats();
    const p = pave<{ currentGrant: { name: string } }>(
      { currentGrant: { id: {}, name: {} }, organization: { $: { id: "orgTest0001" }, id: {} } },
      { stats },
    );
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ currentGrant: { name: "Baxter" } });
    expect(fake.calls).toBe(3);
    expect(stats.retries).toBe(2);
  });

  it("pages with cursors and halves the page size on 413", async () => {
    const fake = installFakePave({ maxPageSize: 5 });
    const nodes = await paginate<{ id: string }>({
      connection: "jobs",
      nodes: { id: {} },
      pageSize: 20,
    });
    expect(nodes.map((n) => n.id)).toEqual(JOBS.map((j) => j.id));
    // 20 → 413, 10 → 413, 5 → ok ×2 pages (6 jobs)
    expect(fake.calls).toBe(4);
  });
});

describe("metadata defaults", () => {
  it("classifies fields conservatively", () => {
    expect(defaultCategory({ name: "Phase", target_type: "job", type: "option" })).toBe("general");
    expect(defaultCategory({ name: "Budget Amount", target_type: "job", type: "number" })).toBe(
      "financial",
    );
    expect(defaultCategory({ name: "Spouse Name", target_type: "customer", type: "text" })).toBe(
      "customer",
    );
    expect(
      defaultCategory({
        name: "Customer Priorities & Must-Haves",
        target_type: "customer",
        type: "text",
      }),
    ).toBe("general");
    expect(
      defaultCategory({ name: "Internal Strategy Notes", target_type: "customer", type: "text" }),
    ).toBe("internal");
    expect(defaultCategory({ name: "Vendor Rating", target_type: "vendor", type: "number" })).toBe(
      "excluded",
    );
    expect(
      defaultCategory({ name: "Site Contact", target_type: "location", type: "phoneNumber" }),
    ).toBe("customer");
  });

  it("keeps multi-value option fields as arrays and drops excluded fields", () => {
    const conn = {
      nodes: [
        { id: "a", value: "Overhead", customField: { id: F.electrical } },
        { id: "b", value: "Solar", customField: { id: F.electrical } },
        { id: "c", value: "", customField: { id: F.pm } },
        { id: "d", value: "secret", customField: { id: "cfNotAllowed" } },
      ],
    };
    expect(collectValues(conn, new Set([F.electrical, F.pm]))).toEqual({
      [F.electrical]: ["Overhead", "Solar"],
    });
  });

  it("normalizes a job node without contacts, phones, or files", () => {
    const row = normalizeJob(JOBS[0]!, new Set(Object.values(F)), "2026-10-22T00:00:00Z");
    expect(row).toMatchObject({
      id: JOBS[0]!.id,
      name: "Test Project 1",
      city: "Testville",
      projected_price: 300000,
      customer_name: "Customer 1",
    });
    expect(row.location_fields[F.electrical]).toEqual(["Overhead", "Solar"]);
    expect(Object.keys(row)).not.toContain("files");
  });
});

describe("sync", () => {
  it("tests the connection without storing the key", async () => {
    installFakePave();
    const row = await testConnection();
    expect(row).toMatchObject({
      status: "connected",
      organization_name: "Acton ADU (test)",
      grant_name: "Baxter",
      grant_is_unrestricted: true,
    });
    expect(JSON.stringify(row)).not.toContain(FAKE_GRANT_KEY);
  });

  it("syncs metadata, jobs, and catalog models, maps business fields, and soft-removes missing jobs", async () => {
    installFakePave();
    const run = await runFullSync("test");
    expect(run.status).toBe("succeeded");
    const fields = await listCustomFields();
    expect(fields.find((f) => f.id === "cfVendor001")?.category).toBe("excluded");
    const semantic = new Map((await listSemanticFields()).map((s) => [s.key, s.custom_field_id]));
    expect(semantic.get("phase")).toBe(F.phase);
    expect(semantic.get("must_have_features")).toBe(F.priorities);
    expect(semantic.get("design_hours")).toBeNull();
    expect(
      await agentDb().select("jt_jobs", { filters: [{ col: "removed_at", op: "is_null" }] }),
    ).toHaveLength(6);
    expect(await agentDb().select("jt_catalog_models", {})).toHaveLength(4);

    // Job 6 disappears from JobTread → soft-removed, not deleted.
    installFakePave({ jobs: JOBS.slice(0, 5) });
    await runFullSync("test");
    const all = await agentDb().select<{ id: string; removed_at: string | null }>("jt_jobs", {});
    expect(all).toHaveLength(6);
    expect(all.find((j) => j.id === JOBS[5]!.id)?.removed_at).not.toBeNull();
  });

  it("never auto-remaps a business field an administrator unmapped", async () => {
    installFakePave();
    await runFullSync("test");
    await updateSemanticField("model", { custom_field_id: null }, "admin-user");
    await runFullSync("test-2");
    const semantic = new Map((await listSemanticFields()).map((s) => [s.key, s.custom_field_id]));
    expect(semantic.get("model")).toBeNull();
  });

  it("records a failed run on an expired grant", async () => {
    installFakePave({ failFirst: [401, 401, 401, 401] });
    const run = await runFullSync("test");
    expect(run.status).toBe("failed");
    expect(run.error).not.toContain(FAKE_GRANT_KEY);
  });

  it("keeps scheduled syncs off unless JOBTREAD_SYNC_ENABLED=true", async () => {
    installFakePave();
    delete process.env.JOBTREAD_SYNC_ENABLED;
    expect((await maybeEnqueueScheduledJobTreadSync()).enqueued).toBe(false);
  });

  it("loads live job detail with schedule milestones, checklists, and file names (no URLs)", async () => {
    installFakePave();
    await runFullSync("test");
    const detail = await getJobDetail(JOBS[0]!.id);
    expect(detail?.milestones.map((m) => [m.name, m.kind, m.status])).toEqual([
      ["Design", "schedule", "complete"],
      ["Permitting", "schedule", "in_progress"],
      ["Design Checklist", "checklist", "not_started"],
    ]);
    expect(detail?.files[0]).toEqual({
      id: "f1",
      name: "Site plan.pdf",
      folder: "Plans",
      type: "application/pdf",
      createdAt: "2026-04-01T00:00:00Z",
    });
    expect(await getJobDetail("bad id!")).toBeNull();
  });
});
