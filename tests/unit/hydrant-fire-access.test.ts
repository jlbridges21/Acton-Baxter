import { describe, expect, it, vi } from "vitest";
import { lookupNearestHydrant } from "@/lib/providers/hydrants/lookup";
import { feetBetween } from "@/lib/providers/hydrants/distance";
import { OverpassError } from "@/lib/providers/hydrants/osm";
import {
  buildSprinklerIndicator,
  formatHydrantDistanceDisplay,
  HYDRANT_PULL_DISTANCE_CAVEAT,
} from "@/lib/research/fire-access";
import {
  buildParcelOverlayParams,
  shouldIncludeHydrantMarker,
} from "@/lib/providers/google/parcel-overlay";
import { buildSiteInspectionItems } from "@/lib/research/site-inspection";
import type { FullReport } from "@/lib/research/db-types";

describe("hydrant distance math", () => {
  it("computes straight-line feet between nearby points", () => {
    const ft = feetBetween(-122.10445, 37.38193, -122.10445, 37.3855);
    expect(ft).toBeGreaterThan(1200);
    expect(ft).toBeLessThan(1500);
  });
});

describe("hydrant lookup priority ladder", () => {
  it("prefers official GIS over OSM", async () => {
    const official = vi.fn(
      async (source: {
        key: string;
        sourceName: string;
        sourceLabel: string;
        sourceUrl: string;
      }) => {
        if (source.key !== "scfd") return null;
        return {
          longitude: -121.95,
          latitude: 37.39,
          distanceFt: 220,
          sourceKey: "scfd" as const,
          sourceName: source.sourceName,
          confidenceLabel: "official_city_gis" as const,
          sourceLabel: source.sourceLabel,
          sourceUrl: source.sourceUrl,
          externalId: "87-1",
        };
      },
    );
    const osm = vi.fn(async () => {
      throw new Error("OSM should not be called");
    });

    const result = await lookupNearestHydrant(-121.95, 37.39, {
      queryOfficial: official,
      queryOsm: osm,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.hydrant.sourceKey).toBe("scfd");
      expect(result.hydrant.distanceFt).toBe(220);
    }
    expect(osm).not.toHaveBeenCalled();
  });

  it("falls through official failures to OSM", async () => {
    const official = vi.fn(async () => {
      throw new Error("layer down");
    });
    const osm = vi.fn(async () => ({
      longitude: -122.1,
      latitude: 37.38,
      distanceFt: 1301,
      sourceKey: "osm" as const,
      sourceName: "OpenStreetMap fire hydrants",
      confidenceLabel: "osm_community" as const,
      sourceLabel: "OpenStreetMap community data — coverage not guaranteed",
      sourceUrl: "https://www.openstreetmap.org/",
      externalId: "1",
    }));

    const result = await lookupNearestHydrant(-122.1, 37.38, {
      queryOfficial: official,
      queryOsm: osm,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.hydrant.sourceKey).toBe("osm");
    }
    expect(result.attemptedSources).toEqual(["scfd", "campbell", "osm"]);
  });

  it("returns honest no-data when nothing is within radius", async () => {
    const result = await lookupNearestHydrant(-121.9355, 37.2502, {
      queryOfficial: async () => null,
      queryOsm: async () => null,
    });
    expect(result.status).toBe("no_data");
    if (result.status === "no_data") {
      expect(result.statusMessage).toMatch(/2,?500/);
      expect(result.manualLookupUrl).toContain("openstreetmap.org");
    }
  });

  it("degrades gracefully when Overpass returns 429/504", async () => {
    const result = await lookupNearestHydrant(-122.1, 37.38, {
      queryOfficial: async () => null,
      queryOsm: async () => {
        throw new OverpassError("Overpass temporarily unavailable (504)", {
          statusCode: 504,
          retryable: true,
        });
      },
    });
    expect(result.status).toBe("no_data");
    if (result.status === "no_data") {
      expect(result.statusMessage).toMatch(/OpenStreetMap lookup failed/i);
    }
  });
});

describe("sprinkler indicator states", () => {
  it("renders all four deterministic states", () => {
    const within = buildSprinklerIndicator({
      jurisdictionKey: "ca-san-jose",
      distanceFt: 120,
      thresholdFt: 150,
      sourceCitation: "SJMC 17.12.010",
    });
    expect(within.state).toBe("within_threshold");
    expect(within.headline).toContain("within the 150 ft threshold");
    expect(within.detail).toMatch(/path-of-travel/i);

    const exceeds = buildSprinklerIndicator({
      jurisdictionKey: "ca-san-jose",
      distanceFt: 420,
      thresholdFt: 150,
      sourceCitation: "SJMC 17.12.010",
    });
    expect(exceeds.state).toBe("exceeds_threshold");
    expect(exceeds.headline).toContain("already exceeds");
    expect(exceeds.detail).toMatch(/likely required/i);

    const noHydrant = buildSprinklerIndicator({
      jurisdictionKey: "ca-san-jose",
      distanceFt: null,
      thresholdFt: 150,
      sourceCitation: "SJMC 17.12.010",
    });
    expect(noHydrant.state).toBe("rule_no_hydrant");
    expect(noHydrant.headline).toContain("150 ft");
    expect(noHydrant.detail).toMatch(/measure pull distance on site/i);

    const noRule = buildSprinklerIndicator({
      jurisdictionKey: "ca-santa-clara-county",
      distanceFt: 200,
      thresholdFt: null,
      sourceCitation: null,
    });
    expect(noRule.state).toBe("no_rule");
    expect(noRule.detail).toContain("/admin/jurisdictions");
  });

  it("keeps pull-distance honesty in hydrant display copy", () => {
    const text = formatHydrantDistanceDisplay({
      distanceFt: 1301,
      sourceLabel: "OpenStreetMap community data — coverage not guaranteed",
    });
    expect(text).toContain("straight-line");
    expect(text).toContain("OpenStreetMap");
    expect(HYDRANT_PULL_DISTANCE_CAVEAT).toMatch(/path of travel/i);
  });
});

describe("parcel overlay hydrant marker", () => {
  const smallParcel = {
    type: "Polygon",
    coordinates: [
      [
        [-121.9356, 37.2501],
        [-121.9354, 37.2501],
        [-121.9354, 37.2503],
        [-121.9356, 37.2503],
        [-121.9356, 37.2501],
      ],
    ],
  };

  it("includes a nearby hydrant marker without changing parcel zoom", () => {
    const result = buildParcelOverlayParams({
      geometry: smallParcel,
      hydrant: { latitude: 37.2502, longitude: -121.9355 },
    });
    expect(result).not.toBeNull();
    expect(result!.hydrantMarkerIncluded).toBe(true);
    expect(result!.markers.some((m) => m.includes("label:H"))).toBe(true);
  });

  it("skips a far hydrant rather than zooming out", () => {
    const result = buildParcelOverlayParams({
      geometry: smallParcel,
      hydrant: { latitude: 37.28, longitude: -121.95 },
    });
    expect(result).not.toBeNull();
    expect(result!.hydrantMarkerSkipped).toBe(true);
    expect(result!.hydrantMarkerIncluded).toBe(false);
    expect(result!.markers).toEqual([]);
  });

  it("shouldIncludeHydrantMarker rejects distant points", () => {
    const rings = smallParcel.coordinates as [number, number][][];
    expect(
      shouldIncludeHydrantMarker({
        rings,
        center: "37.250200,-121.935500",
        zoom: 19,
        width: 640,
        height: 420,
        hydrant: { latitude: 37.28, longitude: -121.95 },
      }),
    ).toBe(false);
  });
});

describe("site inspection hydrant item", () => {
  it("always adds pull-distance measurement for CA reports", () => {
    const report = {
      id: "00000000-0000-4000-8000-000000000099",
      input_address: "25 N Avalon Dr, Los Altos, CA",
      standardized_address: "25 N Avalon Dr, Los Altos, CA 94022",
      apn: null,
      facts: [],
      maps_json: null,
      property_profile_url: null,
    } as unknown as FullReport;

    const items = buildSiteInspectionItems(report);
    expect(items.some((item) => item.id === "hydrant-pull-distance")).toBe(true);
    const hydrant = items.find((item) => item.id === "hydrant-pull-distance")!;
    expect(hydrant.description).toMatch(/straight-line only/i);
    expect(hydrant.verifySteps.join(" ")).toMatch(/path of travel/i);
  });
});
