import { describe, it, expect } from "vitest";
import { getInitials } from "@/lib/ui/initials";
import { paginateGhl } from "@/lib/connectors/ghl/pagination";
import { buildOpportunitySearchQuery } from "@/lib/connectors/ghl/request-contracts";

describe("getInitials", () => {
  it("Jackson Bridges → JB", () => {
    expect(getInitials("Jackson Bridges")).toBe("JB");
  });
  it("James Parks → JP", () => {
    expect(getInitials("James Parks")).toBe("JP");
  });
  it("Kevin Lee → KL", () => {
    expect(getInitials("Kevin Lee")).toBe("KL");
  });
  it("single name → first initial", () => {
    expect(getInitials("Baxter")).toBe("B");
  });
  it("empty → ?", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials(null)).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});

describe("opportunity search status=all", () => {
  it("omits status when all so GHL returns every status", () => {
    const q = buildOpportunitySearchQuery({
      locationId: "loc1",
      pipelineId: "pipe1",
      status: "all",
    });
    expect(q.status).toBeUndefined();
    expect(q.pipelineId).toBe("pipe1");
  });

  it("keeps explicit open/won/lost", () => {
    expect(buildOpportunitySearchQuery({ locationId: "loc1", status: "open" }).status).toBe("open");
    expect(buildOpportunitySearchQuery({ locationId: "loc1", status: "won" }).status).toBe("won");
  });
});

describe("paginateGhl incomplete safeguards", () => {
  it("returns incomplete when page ceiling hit with hasMore", async () => {
    const result = await paginateGhl({
      maxPages: 2,
      maxItems: 1000,
      fetchPage: async ({ page }) => ({
        items: [{ id: page }],
        meta: {
          total: 100,
          hasMore: true,
          nextPageUrl: null,
          startAfterId: `after-${page}`,
          startAfter: null,
          currentPage: page,
          nextPage: page + 1,
        },
      }),
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.incomplete).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.incompleteReason).toMatch(/page safety ceiling/i);
  });

  it("returns complete when exhausted before ceiling", async () => {
    const result = await paginateGhl({
      maxPages: 5,
      maxItems: 100,
      fetchPage: async ({ page }) => ({
        items: [{ id: page }],
        meta: {
          total: 1,
          hasMore: false,
          nextPageUrl: null,
          startAfterId: null,
          startAfter: null,
          currentPage: page,
          nextPage: null,
        },
      }),
    });
    expect(result.incomplete).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(1);
  });
});
