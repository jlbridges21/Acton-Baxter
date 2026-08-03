import { beforeEach, describe, expect, it, vi } from "vitest";

const searchOpportunitiesPaginated = vi.fn();
const listPipelines = vi.fn();
const listUsers = vi.fn();
const getContactById = vi.fn();

vi.mock("@/lib/connectors/ghl/resources/opportunities", () => ({
  searchOpportunitiesPaginated: (...args: unknown[]) => searchOpportunitiesPaginated(...args),
}));

vi.mock("@/lib/connectors/ghl/resources/pipelines", () => ({
  listPipelines: (...args: unknown[]) => listPipelines(...args),
}));

vi.mock("@/lib/connectors/ghl/resources/users", () => ({
  listUsers: (...args: unknown[]) => listUsers(...args),
}));

vi.mock("@/lib/connectors/ghl/resources/contacts", () => ({
  getContactById: (...args: unknown[]) => getContactById(...args),
}));

describe("getStaleOpportunities cutoff edge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    listPipelines.mockResolvedValue([
      { id: "pipe-1", name: "Sales", stages: [{ id: "stage-1", name: "Qualified" }] },
    ]);
    listUsers.mockResolvedValue([{ id: "u1", name: "Owner", email: null }]);
    getContactById.mockResolvedValue(null);
  });

  it("includes opportunities updated exactly at the cutoff and excludes fresher ones", async () => {
    const now = Date.now();
    const days = 3;
    const cutoff = now - days * 24 * 60 * 60 * 1000;

    searchOpportunitiesPaginated.mockResolvedValue({
      opportunities: [
        {
          id: "at-cutoff",
          name: "At cutoff",
          pipelineId: "pipe-1",
          pipelineStageId: "stage-1",
          contactId: null,
          assignedTo: "u1",
          dateUpdated: new Date(cutoff).toISOString(),
          status: "open",
        },
        {
          id: "fresh",
          name: "Fresh",
          pipelineId: "pipe-1",
          pipelineStageId: "stage-1",
          contactId: null,
          assignedTo: "u1",
          dateUpdated: new Date(cutoff + 60_000).toISOString(),
          status: "open",
        },
        {
          id: "stale",
          name: "Stale",
          pipelineId: "pipe-1",
          pipelineStageId: "stage-1",
          contactId: null,
          assignedTo: "u1",
          dateUpdated: new Date(cutoff - 24 * 60 * 60 * 1000).toISOString(),
          status: "open",
        },
      ],
      truncated: false,
      incomplete: false,
      scannedCount: 3,
    });

    const { getStaleOpportunities } = await import("@/lib/connectors/ghl/insights");
    const result = await getStaleOpportunities({ daysSinceUpdate: days, pipelineId: "pipe-1" });
    const ids = result.rows.map((r) => r.opportunityId);
    expect(ids).toContain("at-cutoff");
    expect(ids).toContain("stale");
    expect(ids).not.toContain("fresh");
  });
});
