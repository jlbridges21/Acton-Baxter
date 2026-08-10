/**
 * Multi-prospect PEM NEAT names — split, matching, create/edit, Customer Center.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  formatProspectDisplayName,
  prospectNamesForMatching,
  resolveProspectNamesInput,
  splitProspectNameString,
} from "@/lib/pem-neat/prospect-names";
import { getPemNeatStore, resetPemNeatMemoryStoreForTests } from "@/lib/pem-neat/store";
import {
  buildPemProspectIndex,
  matchProspectInIndex,
  toProspectIndexEntry,
} from "@/lib/baxter-data/pem-neats/prospect-index";
import { scorePemRowNameMatch } from "@/lib/baxter-data/pem-neats/evidence";
import { assembleCustomerDossier } from "@/lib/dossier/assemble";
import type { GhlEntityGraph } from "@/lib/connectors/ghl/entity-graph";

beforeEach(() => {
  process.env.E2E_TEST_AUTH_BYPASS = "true";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  resetEnvCacheForTests();
  resetPemNeatMemoryStoreForTests();
});

const SALES_ID = "00000000-0000-4000-8000-0000000000aa";
const CREATOR = "00000000-0000-4000-8000-0000000000bb";
const TRANSCRIPT = "A".repeat(250);

describe("splitProspectNameString backfill fixtures", () => {
  it("splits realistic combined names and leaves singles intact", () => {
    expect(splitProspectNameString("Cindy Lee & Razel Talle")).toEqual([
      "Cindy Lee",
      "Razel Talle",
    ]);
    expect(splitProspectNameString("Richard & Jeannie L")).toEqual(["Richard", "Jeannie L"]);
    expect(splitProspectNameString("Sharon Liu")).toEqual(["Sharon Liu"]);
    // "and" inside Amanda must not false-split
    expect(splitProspectNameString("Amanda Stone")).toEqual(["Amanda Stone"]);
    expect(splitProspectNameString("Bob and Alice Johnson")).toEqual(["Bob", "Alice Johnson"]);
    expect(formatProspectDisplayName(["Cindy Lee", "Razel Talle"])).toBe("Cindy Lee & Razel Talle");
  });

  it("resolveProspectNamesInput prefers structured list and derives display", () => {
    const resolved = resolveProspectNamesInput({
      prospectNames: [" Cindy Lee ", "Razel Talle", "cindy lee"],
    });
    expect(resolved.prospectNames).toEqual(["Cindy Lee", "Razel Talle"]);
    expect(resolved.prospectName).toBe("Cindy Lee & Razel Talle");
  });
});

describe("multi-prospect matching paths", () => {
  it("finds a two-prospect NEAT by either individual name or the combined display", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Cindy Lee & Razel Talle",
      prospectNames: ["Cindy Lee", "Razel Talle"],
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Jesse",
      transcript: TRANSCRIPT,
      createdBy: CREATOR,
    });
    const mem = (
      globalThis as typeof globalThis & {
        __baxterPemNeatMemory?: {
          neats: Map<string, { status: string; generated_at: string | null }>;
        };
      }
    ).__baxterPemNeatMemory;
    const row = mem?.neats.get(created.id);
    if (row) {
      row.status = "completed";
      row.generated_at = new Date().toISOString();
    }

    const index = await buildPemProspectIndex();
    expect(matchProspectInIndex("Cindy Lee", index).some((m) => m.entry.pemId === created.id)).toBe(
      true,
    );
    expect(
      matchProspectInIndex("Razel Talle", index).some((m) => m.entry.pemId === created.id),
    ).toBe(true);
    expect(
      matchProspectInIndex("Cindy Lee & Razel Talle", index).some(
        (m) => m.entry.pemId === created.id,
      ),
    ).toBe(true);

    const listed = await store.list({ query: "Razel" });
    expect(listed.some((r) => r.id === created.id)).toBe(true);
  });

  it("still finds a legacy combined-only row via query-time split", async () => {
    // Simulate imperfect / pre-backfill storage: structured list is the combined string only.
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "Cindy Lee & Razel Talle",
      prospectNames: ["Cindy Lee & Razel Talle"],
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Jesse",
      transcript: TRANSCRIPT,
      createdBy: CREATOR,
    });
    // Force legacy shape in memory
    const mem = (
      globalThis as typeof globalThis & {
        __baxterPemNeatMemory?: { neats: Map<string, { prospect_names: string[] }> };
      }
    ).__baxterPemNeatMemory;
    const row = mem?.neats.get(created.id);
    if (row) row.prospect_names = ["Cindy Lee & Razel Talle"];

    const names = prospectNamesForMatching({
      prospectName: "Cindy Lee & Razel Talle",
      prospectNames: ["Cindy Lee & Razel Talle"],
    });
    expect(names).toContain("Cindy Lee");
    expect(names).toContain("Razel Talle");

    const entry = toProspectIndexEntry({
      id: created.id,
      prospect_name: "Cindy Lee & Razel Talle",
      prospect_names: ["Cindy Lee & Razel Talle"],
      salesperson_user_id: SALES_ID,
      salesperson_display_name: "Jesse",
      meeting_date: null,
      status: "completed",
      meeting_outcome: null,
      qualification: null,
      analysis_stale: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      generated_at: new Date().toISOString(),
    });
    expect(matchProspectInIndex("Cindy Lee", [entry])).toHaveLength(1);
    expect(matchProspectInIndex("Razel Talle", [entry])).toHaveLength(1);
    expect(
      scorePemRowNameMatch(
        { prospect_name: "Cindy Lee & Razel Talle", prospect_names: ["Cindy Lee & Razel Talle"] },
        "Razel Talle",
      ),
    ).toBeGreaterThanOrEqual(60);
  });
});

describe("create/update multi-prospect persistence", () => {
  it("stores structured names and derived display; edit corrects the list", async () => {
    const store = getPemNeatStore();
    const created = await store.create({
      prospectName: "ignored",
      prospectNames: ["Richard", "Jeannie L"],
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Jesse",
      transcript: TRANSCRIPT,
      createdBy: CREATOR,
    });
    expect(created.prospect_names).toEqual(["Richard", "Jeannie L"]);
    expect(created.prospect_name).toBe("Richard & Jeannie L");

    const updated = await store.updateSource(created.id, {
      prospectName: "Richard & Jeannie Lopez",
      prospectNames: ["Richard Lopez", "Jeannie Lopez"],
      salespersonUserId: SALES_ID,
      salespersonDisplayName: "Jesse",
      transcript: TRANSCRIPT,
      updatedBy: CREATOR,
    });
    expect(updated.prospectNameChanged).toBe(true);
    expect(updated.record.prospect_names).toEqual(["Richard Lopez", "Jeannie Lopez"]);
    expect(updated.record.prospect_name).toBe("Richard Lopez & Jeannie Lopez");
  });
});

describe("Customer Center multi-prospect GHL cross-reference", () => {
  function graphFor(id: string, name: string): GhlEntityGraph {
    return {
      retrievedAt: new Date().toISOString(),
      query: name,
      ambiguous: false,
      clarificationMessage: null,
      opportunityAmbiguous: false,
      contact: {
        id,
        name,
        email: null,
        phone: null,
        address1: null,
        city: null,
        state: null,
        postalCode: null,
        customFields: {},
      } as unknown as GhlEntityGraph["contact"],
      opportunities: [],
      nextAppointment: null,
      recentConversation: null,
      recentMessages: [],
      customFieldLabels: {},
      contactOwnerName: null,
    };
  }

  it("links a two-prospect NEAT to either GHL contact and surfaces both when both match", async () => {
    const resolveGhl = vi.fn(async (query: string) => {
      const q = query.toLowerCase();
      if (q.includes("razel") && !q.includes("cindy")) return graphFor("ghl-razel", "Razel Talle");
      if (q.includes("cindy")) return graphFor("ghl-cindy", "Cindy Lee");
      if (q.includes("razel")) return graphFor("ghl-razel", "Razel Talle");
      return {
        ...graphFor("unused", "none"),
        contact: null,
      };
    });

    const dossier = await assembleCustomerDossier(
      {
        pemNeatId: "pem-multi",
        role: "admin",
        includeMonitoring: false,
      },
      {
        resolveGhl,
        buildPemIndex: async () => [],
        getPemById: async (id) =>
          id === "pem-multi"
            ? {
                id: "pem-multi",
                prospect_name: "Cindy Lee & Razel Talle",
                prospect_names: ["Cindy Lee", "Razel Talle"],
                meeting_date: null,
                meeting_outcome: "YES",
                qualification: "QUALIFIED_WITH_RISKS",
                status: "completed",
              }
            : null,
        listSetupRuns: async () => [],
      },
    );

    expect(dossier.ghl.status).toBe("ok");
    expect(dossier.ghl.contactId).toBe("ghl-cindy");
    expect(dossier.ghl.additionalMatchedContacts.some((c) => c.contactId === "ghl-razel")).toBe(
      true,
    );
    expect(dossier.pemNeats.records[0]?.prospectNames).toEqual(["Cindy Lee", "Razel Talle"]);
  });
});
