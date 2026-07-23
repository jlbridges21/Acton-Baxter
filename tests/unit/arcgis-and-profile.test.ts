import { describe, expect, it } from "vitest";
import { buildArcgisQueryUrl } from "@/lib/arcgis/query";
import { buildPointGeometryJson, esriPolygonToGeoJson } from "@/lib/arcgis/geometry";
import { resolvePropertyProfileAccess } from "@/lib/connectors/california/santa-clara-county/property-profile";

describe("ArcGIS query construction", () => {
  it("builds a spatial point query URL", () => {
    const geometry = buildPointGeometryJson(-121.877, 37.342);
    const url = buildArcgisQueryUrl("https://example.com/FeatureServer/0", {
      geometry,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "APN,ZONING",
      returnGeometry: true,
      resultRecordCount: 5,
    });

    expect(url).toContain("geometryType=esriGeometryPoint");
    expect(url).toContain("spatialRel=esriSpatialRelIntersects");
    expect(url).toContain("inSR=4326");
    expect(url).toContain("outFields=APN%2CZONING");
    expect(url).toContain("f=json");
  });

  it("builds an attribute query URL", () => {
    const url = buildArcgisQueryUrl("https://example.com/FeatureServer/0", {
      where: "APN='47222019'",
      outFields: "*",
      returnGeometry: true,
    });
    expect(url).toContain("where=APN%3D%2747222019%27");
    expect(url).toContain("returnGeometry=true");
  });
});

describe("ArcGIS geometry conversion", () => {
  it("converts a single-ring polygon to GeoJSON Polygon", () => {
    const geojson = esriPolygonToGeoJson({
      rings: [
        [
          [-121.88, 37.34],
          [-121.87, 37.34],
          [-121.87, 37.35],
          [-121.88, 37.35],
          [-121.88, 37.34],
        ],
      ],
    });
    expect(geojson?.type).toBe("Polygon");
    expect(geojson?.coordinates).toHaveLength(1);
  });

  it("converts multi-ring geometry to MultiPolygon", () => {
    const geojson = esriPolygonToGeoJson({
      rings: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
        [
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2],
        ],
      ],
    });
    expect(geojson?.type).toBe("MultiPolygon");
    expect(geojson?.coordinates).toHaveLength(2);
  });

  it("returns null for empty rings", () => {
    expect(esriPolygonToGeoJson({ rings: [] })).toBeNull();
  });
});

describe("Property Profile access", () => {
  it("returns generic_search with APN guidance", () => {
    const access = resolvePropertyProfileAccess({
      address: "655 13th St, San Jose, CA",
      apn: "47222019",
    });
    expect(access.accessType).toBe("generic_search");
    expect(access.openLabel).toBe("Search County Property Profile");
    expect(access.statusMessage).toContain("47222019");
    expect(access.url).toContain("experience.arcgis.com");
  });

  it("still provides a generic Experience link without APN", () => {
    const access = resolvePropertyProfileAccess({
      address: "655 13th St, San Jose, CA",
    });
    expect(access.accessType).toBe("generic_search");
    expect(access.available).toBe(true);
  });
});
