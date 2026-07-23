import type { ArcgisPolygonGeometry, ArcgisRing } from "./types";

function ringToPositions(ring: ArcgisRing): number[][] {
  return ring
    .map((point) => {
      const x = point[0];
      const y = point[1];
      if (typeof x !== "number" || typeof y !== "number") return null;
      return [x, y];
    })
    .filter((point): point is number[] => point !== null);
}

function closeRing(positions: number[][]): number[][] {
  if (positions.length === 0) return positions;
  const first = positions[0]!;
  const last = positions[positions.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) {
    return positions;
  }
  return [...positions, [...first]];
}

/**
 * Convert Esri polygon rings to GeoJSON Polygon or MultiPolygon.
 * Esri rings may include exterior and interior rings; we treat each ring as a
 * polygon ring array. Multiple exterior-like rings become MultiPolygon.
 */
export function esriPolygonToGeoJson(geometry: ArcgisPolygonGeometry | null | undefined): {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
} | null {
  if (!geometry?.rings?.length) return null;

  const rings = geometry.rings
    .map((ring) => closeRing(ringToPositions(ring)))
    .filter((ring) => ring.length >= 4);

  if (rings.length === 0) return null;

  if (rings.length === 1) {
    return {
      type: "Polygon",
      coordinates: [rings[0]!],
    };
  }

  // Treat each ring as its own polygon exterior when ring-role metadata is absent.
  return {
    type: "MultiPolygon",
    coordinates: rings.map((ring) => [ring]),
  };
}

export function calculatePolygonCentroid(
  geometry: ArcgisPolygonGeometry | null | undefined,
): { latitude: number; longitude: number } | null {
  if (!geometry?.rings?.[0]?.length) return null;
  const ring = geometry.rings[0]!;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const point of ring) {
    const x = point[0];
    const y = point[1];
    if (typeof x !== "number" || typeof y !== "number") continue;
    sumX += x;
    sumY += y;
    count += 1;
  }
  if (count === 0) return null;
  return {
    longitude: sumX / count,
    latitude: sumY / count,
  };
}

export function buildPointGeometryJson(longitude: number, latitude: number): string {
  return JSON.stringify({
    x: longitude,
    y: latitude,
    spatialReference: { wkid: 4326 },
  });
}
