import { describe, expect, it, beforeEach } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  filterAndRankApprovedKnowledge,
  isMeaningfulKnowledgeChange,
  scoreKnowledgeMatch,
} from "@/lib/knowledge/retrieval";
import { canEmployeeReadEntry, assertCanManageKnowledge } from "@/lib/knowledge/permissions";
import { normalizeTags } from "@/lib/knowledge/schemas";
import {
  createKnowledgeEntry,
  listAllKnowledgeEntriesForRetrieval,
  resetKnowledgeMemoryForTests,
  setKnowledgeEntryStatus,
  updateKnowledgeEntry,
} from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import type { KnowledgeEntry } from "@/lib/knowledge/types";
import { AuthorizationError } from "@/lib/errors";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetKnowledgeMemoryForTests();
});

function baseEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "PEM Preparation Checklist",
    content: "Complete the property research brief before the Partnership Evaluation Meeting.",
    summary: "PEM prep steps",
    category: "PEM Preparation",
    tags: ["pem", "sales"],
    source_name: "Sales Process",
    source_type: "procedure",
    source_url: null,
    source_external_id: null,
    status: "approved",
    visibility: "internal",
    version: 1,
    created_by: "user",
    updated_by: "user",
    approved_by: "admin",
    approved_at: now,
    archived_at: null,
    created_at: now,
    updated_at: now,
    metadata: {},
    ...overrides,
  };
}

describe("knowledge permissions and tags", () => {
  it("normalizes tags", () => {
    expect(normalizeTags("PEM, sales, PEM,  ")).toEqual(["PEM", "sales"]);
  });

  it("blocks non-admins from managing knowledge", () => {
    expect(() => assertCanManageKnowledge("user")).toThrow(AuthorizationError);
  });

  it("only allows employees to read approved internal entries", () => {
    expect(canEmployeeReadEntry(baseEntry())).toBe(true);
    expect(canEmployeeReadEntry(baseEntry({ status: "draft" }))).toBe(false);
    expect(canEmployeeReadEntry(baseEntry({ status: "archived" }))).toBe(false);
    expect(canEmployeeReadEntry(baseEntry({ visibility: "admin_only" }))).toBe(false);
  });
});

describe("knowledge retrieval scoring", () => {
  it("prioritizes title and tag matches", () => {
    const titled = scoreKnowledgeMatch(baseEntry({ title: "PTO Policy" }), "pto");
    const contentOnly = scoreKnowledgeMatch(
      baseEntry({ title: "Other", tags: [], content: "something about pto buried here" }),
      "pto",
    );
    expect(titled).toBeGreaterThan(contentOnly);
  });

  it("excludes draft, archived, and admin_only from employee retrieval", () => {
    const results = filterAndRankApprovedKnowledge(
      [
        baseEntry({ id: "1", title: "Approved PEM" }),
        baseEntry({ id: "2", title: "Draft PEM", status: "draft" }),
        baseEntry({ id: "3", title: "Archived PEM", status: "archived" }),
        baseEntry({ id: "4", title: "Admin PEM", visibility: "admin_only" }),
      ],
      { query: "PEM", limit: 10 },
    );
    expect(results.map((row) => row.id)).toEqual(["1"]);
    expect(results[0]?.citationLabel).toContain("Sales Process");
  });

  it("enforces result limits and handles empty queries", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      baseEntry({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        title: `Entry ${index}`,
      }),
    );
    expect(filterAndRankApprovedKnowledge(many, { query: "", limit: 5 })).toHaveLength(5);
  });
});

describe("knowledge store mutations", () => {
  it("creates revisions and returns approved entries to draft on meaningful edit", async () => {
    const created = await createKnowledgeEntry(
      {
        title: "Site Inspection Checklist",
        content: "Inspect the rear yard and utility access before quoting.",
        category: "Production SOP",
        tags: "inspection",
        source_type: "procedure",
        visibility: "internal",
        status: "approved",
      },
      "admin-1",
    );
    expect(created.status).toBe("approved");

    const updated = await updateKnowledgeEntry(
      created.id,
      {
        title: "Site Inspection Checklist",
        content: "Inspect the rear yard, side yard, and utility access before quoting.",
        category: "Production SOP",
        tags: "inspection",
        source_type: "procedure",
        visibility: "internal",
        change_note: "Clarified side yard",
      },
      "admin-1",
    );
    expect(updated.status).toBe("draft");
    expect(updated.version).toBe(2);
    expect(updated.approved_at).toBeNull();

    const approved = await setKnowledgeEntryStatus(created.id, "approved", "admin-1");
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe("admin-1");
    expect(approved.approved_at).toBeTruthy();

    const searchable = await searchApprovedKnowledge({ query: "utility" });
    expect(searchable.some((row) => row.id === created.id)).toBe(true);

    await setKnowledgeEntryStatus(created.id, "archived", "admin-1");
    const afterArchive = await searchApprovedKnowledge({ query: "utility" });
    expect(afterArchive.some((row) => row.id === created.id)).toBe(false);

    const all = await listAllKnowledgeEntriesForRetrieval();
    expect(all).toHaveLength(1);
  });

  it("detects meaningful content changes", () => {
    const entry = baseEntry();
    expect(
      isMeaningfulKnowledgeChange(entry, {
        title: entry.title,
        content: entry.content,
        summary: entry.summary,
        category: entry.category,
        tags: entry.tags,
      }),
    ).toBe(false);
    expect(
      isMeaningfulKnowledgeChange(entry, {
        title: entry.title,
        content: "changed",
        summary: entry.summary,
        category: entry.category,
        tags: entry.tags,
      }),
    ).toBe(true);
  });
});
