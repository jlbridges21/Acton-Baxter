import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildPipelineBoard } from "@/lib/connectors/ghl/pipeline-board";
import type { GhlPipeline, GhlOpportunity } from "@/lib/connectors/ghl/types";

vi.mock("@/lib/connectors/ghl/resources/pipelines");
vi.mock("@/lib/connectors/ghl/resources/opportunities");
vi.mock("@/lib/connectors/ghl/admin-views");
vi.mock("@/lib/connectors/ghl/reference-data");

const mockGetPipelineById = vi.hoisted(() => vi.fn());
const mockSearchOpportunities = vi.hoisted(() => vi.fn());
const mockHydrateOpportunityRows = vi.hoisted(() => vi.fn());
const mockGetGhlReferenceData = vi.hoisted(() => vi.fn());

vi.mock("@/lib/connectors/ghl/resources/pipelines", () => ({
  getPipelineById: mockGetPipelineById,
}));

vi.mock("@/lib/connectors/ghl/resources/opportunities", () => ({
  searchOpportunities: mockSearchOpportunities,
}));

vi.mock("@/lib/connectors/ghl/admin-views", () => ({
  hydrateOpportunityRows: mockHydrateOpportunityRows,
}));

vi.mock("@/lib/connectors/ghl/reference-data", () => ({
  getGhlReferenceData: mockGetGhlReferenceData,
}));

describe("buildPipelineBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetGhlReferenceData.mockResolvedValue({
      users: [
        { id: "user1", name: "John Doe", email: "john@example.com" },
        { id: "user2", name: "Jane Smith", email: "jane@example.com" },
      ],
    });

    mockSearchOpportunities.mockResolvedValue({
      opportunities: [],
      hasMore: false,
      total: 0,
    });

    mockHydrateOpportunityRows.mockImplementation(async (opps: GhlOpportunity[]) =>
      opps.map((o) => ({
        id: o.id,
        name: o.name,
        contactId: o.contactId,
        contactName: o.name,
        pipelineId: o.pipelineId,
        pipelineName: "Sales Pipeline",
        stageId: o.pipelineStageId,
        stageName: "Stage",
        monetaryValue: o.monetaryValue,
        valueLabel: o.monetaryValue != null ? `$${o.monetaryValue}` : null,
        ownerId: o.assignedTo,
        ownerName: o.assignedTo ? "Owner" : null,
        status: o.status ?? "open",
        source: o.source,
        updatedAt: o.dateUpdated,
        updatedLabel: null,
      })),
    );
  });

  it("should sort stages by position ascending", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [
        { id: "stage3", name: "Closed", position: 3 },
        { id: "stage1", name: "Lead", position: 1 },
        { id: "stage2", name: "Qualified", position: 2 },
      ],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);

    const result = await buildPipelineBoard("pipeline1");

    expect(result.pipeline.stages).toEqual([
      { id: "stage1", name: "Lead", position: 1 },
      { id: "stage2", name: "Qualified", position: 2 },
      { id: "stage3", name: "Closed", position: 3 },
    ]);

    expect(result.columns[0]?.stageId).toBe("stage1");
    expect(result.columns[1]?.stageId).toBe("stage2");
    expect(result.columns[2]?.stageId).toBe("stage3");
  });

  it("should group opportunities under correct stages", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [
        { id: "stage1", name: "Lead", position: 1 },
        { id: "stage2", name: "Qualified", position: 2 },
      ],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);

    mockSearchOpportunities.mockImplementation(async ({ pipelineStageId }) => {
      if (pipelineStageId === "stage1") {
        return {
          opportunities: [
            { id: "opp1", name: "Opp 1", pipelineStageId: "stage1" },
          ] as GhlOpportunity[],
          hasMore: false,
          total: 1,
        };
      }
      if (pipelineStageId === "stage2") {
        return {
          opportunities: [
            { id: "opp2", name: "Opp 2", pipelineStageId: "stage2" },
            { id: "opp3", name: "Opp 3", pipelineStageId: "stage2" },
          ] as GhlOpportunity[],
          hasMore: false,
          total: 2,
        };
      }
      return { opportunities: [], hasMore: false, total: 0 };
    });

    mockHydrateOpportunityRows.mockImplementation(async (opps) =>
      opps.map((o: GhlOpportunity) => ({
        id: o.id,
        name: o.name,
        stageId: o.pipelineStageId,
        pipelineId: o.pipelineId,
        stageName: null,
        pipelineName: null,
        contactId: null,
        contactName: null,
        valueLabel: null,
        ownerName: null,
        status: "open",
        source: null,
        updatedLabel: null,
        ownerId: null,
        monetaryValue: null,
        updatedAt: null,
      })),
    );

    const result = await buildPipelineBoard("pipeline1");

    expect(result.columns[0]?.cards).toHaveLength(1);
    expect(result.columns[0]?.cards[0]?.id).toBe("opp1");

    expect(result.columns[1]?.cards).toHaveLength(2);
    expect(result.columns[1]?.cards[0]?.id).toBe("opp2");
    expect(result.columns[1]?.cards[1]?.id).toBe("opp3");
  });

  it("should use hydrated fields from hydrateOpportunityRows", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [{ id: "stage1", name: "Lead", position: 1 }],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);
    mockSearchOpportunities.mockResolvedValue({
      opportunities: [
        {
          id: "opp1",
          name: "Opp 1",
          pipelineStageId: "stage1",
          assignedTo: "user1",
          monetaryValue: 1000,
        } as GhlOpportunity,
      ],
      hasMore: false,
      total: 1,
    });

    mockHydrateOpportunityRows.mockResolvedValue([
      {
        id: "opp1",
        name: "Opp 1",
        stageId: "stage1",
        ownerName: "John Doe",
        valueLabel: "$1,000.00",
        stageName: "Lead",
        pipelineName: "Sales Pipeline",
        contactId: null,
        contactName: null,
        pipelineId: "pipeline1",
        status: "open",
        source: null,
        updatedLabel: "2 days ago",
        ownerId: "user1",
        monetaryValue: 1000,
        updatedAt: null,
      },
    ]);

    const result = await buildPipelineBoard("pipeline1");

    expect(result.columns[0]?.cards[0]?.ownerName).toBe("John Doe");
    expect(result.columns[0]?.cards[0]?.valueLabel).toBe("$1,000.00");
    expect(result.columns[0]?.cards[0]?.stageName).toBe("Lead");
  });

  it("should respect perStageLimit in per-stage fetching", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [{ id: "stage1", name: "Lead", position: 1 }],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);
    mockSearchOpportunities.mockResolvedValue({
      opportunities: [],
      hasMore: false,
      total: 0,
    });
    mockHydrateOpportunityRows.mockResolvedValue([]);

    await buildPipelineBoard("pipeline1", { perStageLimit: 10 });

    expect(mockSearchOpportunities).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
      }),
    );
  });

  it("should filter opportunities by source client-side when provided", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [{ id: "stage1", name: "Lead", position: 1 }],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);
    mockSearchOpportunities.mockResolvedValue({
      opportunities: [
        { id: "opp1", name: "Opp 1", pipelineStageId: "stage1", source: "Website" },
        { id: "opp2", name: "Opp 2", pipelineStageId: "stage1", source: "Referral" },
        { id: "opp3", name: "Opp 3", pipelineStageId: "stage1", source: "Website Form" },
      ] as GhlOpportunity[],
      hasMore: false,
      total: 3,
    });

    mockHydrateOpportunityRows.mockImplementation(async (opps) =>
      opps.map((o: GhlOpportunity) => ({
        id: o.id,
        name: o.name,
        stageId: o.pipelineStageId,
        source: o.source,
        pipelineId: o.pipelineId,
        stageName: null,
        pipelineName: null,
        contactId: null,
        contactName: null,
        valueLabel: null,
        ownerName: null,
        status: "open",
        updatedLabel: null,
        ownerId: null,
        monetaryValue: null,
        updatedAt: null,
      })),
    );

    const result = await buildPipelineBoard("pipeline1", { source: "website" });

    expect(result.columns[0]?.cards).toHaveLength(2);
    expect(result.columns[0]?.cards[0]?.source).toContain("Website");
    expect(result.columns[0]?.cards[1]?.source).toContain("Website");
  });

  it("should return users for filter dropdown", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [{ id: "stage1", name: "Lead", position: 1 }],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);
    mockSearchOpportunities.mockResolvedValue({
      opportunities: [],
      hasMore: false,
      total: 0,
    });
    mockHydrateOpportunityRows.mockResolvedValue([]);

    const result = await buildPipelineBoard("pipeline1");

    expect(result.filters.users).toHaveLength(2);
    expect(result.filters.users[0]).toEqual({ id: "user1", name: "John Doe" });
    expect(result.filters.users[1]).toEqual({ id: "user2", name: "Jane Smith" });
  });

  it("should throw error when pipeline not found", async () => {
    mockGetPipelineById.mockResolvedValue(null);

    await expect(buildPipelineBoard("invalid")).rejects.toThrow("Pipeline invalid not found");
  });

  it("should use search mode with query and bounded max 200", async () => {
    const mockPipeline: GhlPipeline = {
      id: "pipeline1",
      name: "Sales Pipeline",
      locationId: "loc1",
      stages: [
        { id: "stage1", name: "Lead", position: 1 },
        { id: "stage2", name: "Qualified", position: 2 },
      ],
    };

    mockGetPipelineById.mockResolvedValue(mockPipeline);
    mockSearchOpportunities.mockResolvedValue({
      opportunities: [
        { id: "opp1", name: "Matching Opp", pipelineStageId: "stage1" },
      ] as GhlOpportunity[],
      hasMore: false,
      total: 1,
    });
    mockHydrateOpportunityRows.mockImplementation(async (opps) =>
      opps.map((o: GhlOpportunity) => ({
        id: o.id,
        name: o.name,
        stageId: o.pipelineStageId,
        pipelineId: o.pipelineId,
        stageName: null,
        pipelineName: null,
        contactId: null,
        contactName: null,
        valueLabel: null,
        ownerName: null,
        status: "open",
        source: null,
        updatedLabel: null,
        ownerId: null,
        monetaryValue: null,
        updatedAt: null,
      })),
    );

    await buildPipelineBoard("pipeline1", { q: "matching" });

    expect(mockSearchOpportunities).toHaveBeenCalledTimes(1);
    expect(mockSearchOpportunities).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "matching",
        pipelineId: "pipeline1",
        limit: 200,
      }),
    );
  });
});
