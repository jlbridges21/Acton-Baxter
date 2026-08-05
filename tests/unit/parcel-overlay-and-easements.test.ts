import { describe, expect, it } from "vitest";
import { buildParcelOverlayParams, encodePolyline } from "@/lib/providers/google/parcel-overlay";
import { buildSiteInspectionItems } from "@/lib/research/site-inspection";
import type { FullReport, PropertyFactRow } from "@/lib/research/db-types";

function fact(fieldKey: string, value: string): PropertyFactRow {
  return {
    id: fieldKey,
    report_id: "report",
    category: "characteristics",
    field_key: fieldKey,
    field_label: fieldKey,
    normalized_value_text: value,
    normalized_value_number: null,
    normalized_value_boolean: null,
    unit: null,
    preferred_source_name: "test",
    preferred_source_url: null,
    confidence: "medium",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function reportFixture(overrides: Partial<FullReport> = {}): FullReport {
  return {
    id: "report",
    created_by: "user",
    input_address: "25 N Avalon Dr, Los Altos, CA 94022",
    standardized_address: "25 N Avalon Dr, Los Altos, CA 94022",
    status: "complete",
    jurisdiction_name: "Los Altos",
    jurisdiction_type: "incorporated",
    county: "Santa Clara",
    state: "CA",
    latitude: 37.3819,
    longitude: -122.1044,
    apn: "167-34-001",
    summary: null,
    report_version: "1",
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    maps_json: {
      assessorUrl: "https://asr.santaclaracounty.gov/online-services/property-search/real-property",
    },
    property_profile_url:
      "https://experience.arcgis.com/experience/b6175d89a38649a898e409d44f3da90b",
    facts: [],
    claims: [],
    conflicts: [],
    sources: [],
    parcelGeometry: null,
    siteObservations: [],
    pemPreparation: null,
    ...overrides,
  };
}

describe("Google Static Maps parcel overlay", () => {
  it("encodes standard Google polylines using GeoJSON longitude/latitude positions", () => {
    expect(
      encodePolyline([
        [-120.2, 38.5],
        [-120.95, 40.7],
        [-126.453, 43.252],
      ]),
    ).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("fits a WGS84 parcel with margin and emits one styled encoded path", () => {
    const result = buildParcelOverlayParams({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.1047, 37.3817],
            [-122.1041, 37.3817],
            [-122.1041, 37.3822],
            [-122.1047, 37.3822],
            [-122.1047, 37.3817],
          ],
        ],
      },
    });

    expect(result).not.toBeNull();
    expect(result?.coordinateSystem).toBe("wgs84");
    expect(result?.center).toBe("37.381950,-122.104400");
    expect(result?.zoom).toBeGreaterThanOrEqual(18);
    expect(result?.paths).toHaveLength(1);
    expect(result?.paths[0]).toMatch(/weight:4.*color:0xFFD400FF.*enc:/);
  });

  it("converts a Web Mercator geometry before fitting", () => {
    const result = buildParcelOverlayParams({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-13_593_500, 4_497_900],
            [-13_593_400, 4_497_900],
            [-13_593_400, 4_498_000],
            [-13_593_500, 4_498_000],
            [-13_593_500, 4_497_900],
          ],
        ],
      },
    });

    expect(result?.coordinateSystem).toBe("web_mercator_converted");
    const [latitude, longitude] = result!.center.split(",").map(Number);
    expect(latitude).toBeGreaterThan(37);
    expect(latitude).toBeLessThan(39);
    expect(longitude).toBeGreaterThan(-123);
    expect(longitude).toBeLessThan(-121);
  });

  it("renders every ring in a MultiPolygon", () => {
    const result = buildParcelOverlayParams({
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-122.1, 37.38],
              [-122.0998, 37.38],
              [-122.0998, 37.3802],
              [-122.1, 37.38],
            ],
          ],
          [
            [
              [-122.0995, 37.3804],
              [-122.0993, 37.3804],
              [-122.0993, 37.3806],
              [-122.0995, 37.3804],
            ],
          ],
        ],
      },
    });

    expect(result?.paths).toHaveLength(2);
  });

  it("simplifies a detailed boundary enough for a constrained URL budget", () => {
    const pointCount = 8_000;
    const ring = Array.from({ length: pointCount }, (_, index) => {
      const angle = (index / pointCount) * Math.PI * 2;
      const radius = 0.001 + Math.sin(index * 0.37) * 0.00003;
      return [-122.1044 + Math.cos(angle) * radius, 37.3819 + Math.sin(angle) * radius];
    });
    ring.push(ring[0]!);

    const result = buildParcelOverlayParams({
      geometry: { type: "Polygon", coordinates: [ring] },
      maxUrlLength: 1_200,
    });

    expect(result?.simplified).toBe(true);
    expect(result!.renderedPointCount).toBeLessThan(result!.originalPointCount / 10);
    expect(result!.renderedPointCount).toBeGreaterThanOrEqual(4);
    expect(result?.paths[0]).toContain("enc:");
    const params = new URLSearchParams({
      center: result!.center,
      zoom: String(result!.zoom),
      size: "640x420",
      maptype: "satellite",
      scale: "2",
      key: "x".repeat(64),
    });
    for (const path of result!.paths) params.append("path", path);
    expect(
      `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`.length,
    ).toBeLessThanOrEqual(1_200);
  });
});

describe("APN-first easement and tract-map workflow", () => {
  it("prefills APN/subdivision and treats tract number as optional bonus context", () => {
    const report = reportFixture({
      facts: [fact("subdivision", "Country Club Acres"), fact("tract_number", "Tract 512")],
    });
    const item = buildSiteInspectionItems(report).find(
      (candidate) => candidate.id === "easements-tract-maps",
    )!;

    expect(item.description).toMatch(/cannot determine recorded easements automatically/i);
    expect(item.verifySteps.join(" ")).toContain("APN 167-34-001");
    expect(item.verifySteps.join(" ")).toContain("Country Club Acres");
    expect(item.verifySteps.join(" ")).toContain("Tract 512");
    expect(item.facts).toContainEqual({
      label: "Tract / map number (bonus identifier)",
      value: "Tract 512",
    });
    expect(item.links?.map((link) => link.label)).toEqual([
      "County assessor property search",
      "County Property Profile / Explorer",
      "County Surveyor recorded-map index",
      "Clerk-Recorder recorded-document research",
    ]);
  });

  it("remains complete with no tract number, subdivision, or APN", () => {
    const report = reportFixture({
      apn: null,
      property_profile_url: null,
      facts: [],
    });
    const item = buildSiteInspectionItems(report).find(
      (candidate) => candidate.id === "easements-tract-maps",
    )!;
    const text = item.verifySteps.join(" ");

    expect(item.verifySteps).toHaveLength(4);
    expect(text).toContain("the property address (25 N Avalon Dr, Los Altos, CA 94022)");
    expect(text).not.toMatch(/undefined|null/);
    expect(item.links).toHaveLength(3);
    expect(item.links?.every((link) => link.href.startsWith("https://"))).toBe(true);
  });
});
