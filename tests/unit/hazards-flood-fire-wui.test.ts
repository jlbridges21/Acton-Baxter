import { beforeEach, describe, expect, it, vi } from "vitest";

import { describeFemaFloodZone } from "@/lib/providers/hazards/descriptions";
import { WUI_CAVEAT } from "@/lib/research/constants";
import { lookupPropertyHazards } from "@/lib/providers/hazards/lookup";

vi.mock("@/lib/arcgis/query", () => ({
  queryPointIntersects: vi.fn(),
}));

import { queryPointIntersects } from "@/lib/arcgis/query";

const mockedQuery = vi.mocked(queryPointIntersects);

function okFeatures(attributes: Record<string, unknown>) {
  return {
    data: { features: [{ attributes, geometry: null }] },
    responseTimeMs: 12,
    httpStatus: 200,
    endpoint: "https://example.com",
  };
}

function emptyFeatures() {
  return {
    data: { features: [] },
    responseTimeMs: 8,
    httpStatus: 200,
    endpoint: "https://example.com",
  };
}

describe("FEMA flood zone descriptions", () => {
  it("describes zone X minimal and 0.2% subtypes", () => {
    expect(describeFemaFloodZone("X", "AREA OF MINIMAL FLOOD HAZARD")).toMatch(
      /Minimal Flood Hazard/i,
    );
    expect(describeFemaFloodZone("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD")).toMatch(/0\.2%/);
  });

  it("describes SFHA zones with plain language", () => {
    expect(describeFemaFloodZone("AE", null)).toMatch(/Special Flood Hazard Area/);
    expect(describeFemaFloodZone("D", null)).toMatch(/undetermined/i);
  });
});

describe("lookupPropertyHazards", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("returns flood, fire, and WUI together with WUI caveat language", async () => {
    mockedQuery.mockImplementation(async (layerUrl: string) => {
      if (layerUrl.includes("NFHL")) {
        return okFeatures({
          FLD_ZONE: "X",
          ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
          SFHA_TF: "F",
        });
      }
      if (layerUrl.includes("FHSZSRA")) {
        return emptyFeatures();
      }
      if (layerUrl.includes("FHSALRA") || layerUrl.includes("FHSZLRA")) {
        return okFeatures({
          SRA: "LRA",
          FHSZ: -3,
          FHSZ_Description: "NonWildland",
        });
      }
      if (layerUrl.includes("WUI") || layerUrl.includes("Wildland_Urban")) {
        return emptyFeatures();
      }
      return emptyFeatures();
    });

    const result = await lookupPropertyHazards(-122.1044526, 37.3819262);

    expect(result.flood.status).toBe("ok");
    expect(result.flood.displayText).toMatch(/0\.2%/);
    expect(result.fire.status).toBe("ok");
    expect(result.fire.displayText).toMatch(/NonWildland/);
    expect(result.fire.displayText).toMatch(/LRA/);
    expect(result.wui.status).toBe("ok");
    expect(result.wui.displayText).toContain(WUI_CAVEAT);
    expect(result.wui.displayText).toMatch(/Not mapped as Interface/i);
  });

  it("keeps flood/fire when WUI layer throws", async () => {
    mockedQuery.mockImplementation(async (layerUrl: string) => {
      if (layerUrl.includes("NFHL")) {
        return okFeatures({ FLD_ZONE: "D", ZONE_SUBTY: null, SFHA_TF: "F" });
      }
      if (layerUrl.includes("FHSZSRA")) {
        return emptyFeatures();
      }
      if (layerUrl.includes("FHSALRA") || layerUrl.includes("FHSZLRA")) {
        return okFeatures({
          SRA: "LRA",
          FHSZ: -3,
          FHSZ_Description: "NonWildland",
        });
      }
      if (layerUrl.includes("WUI") || layerUrl.includes("Wildland_Urban")) {
        throw new Error("forced WUI timeout");
      }
      return emptyFeatures();
    });

    const result = await lookupPropertyHazards(-121.9355189, 37.2502014);
    expect(result.flood.status).toBe("ok");
    expect(result.flood.displayText).toMatch(/^D/);
    expect(result.fire.status).toBe("ok");
    expect(result.wui.status).toBe("error");
    expect(result.wui.displayText).toBeNull();
    expect(result.wui.viewerUrl).toMatch(/wildland-urban-interface|fire\.ca\.gov|cnra/i);
  });

  it("falls back to manual-review style results outside California for fire/WUI", async () => {
    mockedQuery.mockImplementation(async (layerUrl: string) => {
      if (layerUrl.includes("NFHL")) {
        return okFeatures({
          FLD_ZONE: "X",
          ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD",
          SFHA_TF: "F",
        });
      }
      throw new Error("should not query CA layers for NYC fire/wui bbox short-circuit");
    });

    const result = await lookupPropertyHazards(-74.006, 40.7128);
    expect(result.flood.status).toBe("ok");
    expect(result.fire.status).toBe("no_coverage");
    expect(result.fire.displayText).toBeNull();
    expect(result.fire.viewerUrl).toBeTruthy();
    expect(result.wui.status).toBe("no_coverage");
    expect(result.wui.displayText).toBeNull();
  });

  it("includes WUI caveat when a WUI class is returned", async () => {
    mockedQuery.mockImplementation(async (layerUrl: string) => {
      if (layerUrl.includes("NFHL")) return emptyFeatures();
      if (layerUrl.includes("FHSZ") || layerUrl.includes("FHSALRA")) return emptyFeatures();
      if (layerUrl.includes("WUI") || layerUrl.includes("Wildland_Urban")) {
        return okFeatures({
          WUI_NUM: 2,
          WUI_DESC: "Intermix",
          HAZ_NUM: 3,
          HAZ_DESC: "Very High",
        });
      }
      return emptyFeatures();
    });

    const result = await lookupPropertyHazards(-118.7798, 34.0259);
    expect(result.wui.displayText).toMatch(/Intermix/);
    expect(result.wui.displayText).toContain(WUI_CAVEAT);
  });
});
