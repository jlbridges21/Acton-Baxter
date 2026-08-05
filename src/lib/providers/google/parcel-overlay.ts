export const GOOGLE_STATIC_MAP_MAX_URL_LENGTH = 16_384;
const TARGET_URL_LENGTH = 15_500;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;
const TILE_SIZE = 256;

type Position = [number, number];
type Ring = Position[];

export type ParcelOverlayGeometry = {
  type?: unknown;
  coordinates?: unknown;
};

export type ParcelOverlayParams = {
  center: string;
  zoom: number;
  paths: string[];
  coordinateSystem: "wgs84" | "web_mercator_converted";
  originalPointCount: number;
  renderedPointCount: number;
  simplified: boolean;
};

function isFinitePosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function extractRings(geometry: ParcelOverlayGeometry | null | undefined): Ring[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];

  if (geometry.type === "Polygon") {
    return geometry.coordinates
      .filter(Array.isArray)
      .map((ring) => (ring as unknown[]).filter(isFinitePosition));
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) =>
      Array.isArray(polygon)
        ? polygon.filter(Array.isArray).map((ring) => (ring as unknown[]).filter(isFinitePosition))
        : [],
    );
  }

  return [];
}

function webMercatorToWgs84([x, y]: Position): Position {
  const boundedY = Math.max(-WEB_MERCATOR_LIMIT, Math.min(WEB_MERCATOR_LIMIT, y));
  const longitude = (x / WEB_MERCATOR_LIMIT) * 180;
  const latitude =
    (Math.atan(Math.exp((boundedY / WEB_MERCATOR_LIMIT) * Math.PI)) * 360) / Math.PI - 90;
  return [longitude, latitude];
}

function closeRing(ring: Ring): Ring {
  if (ring.length < 3) return [];
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function normalizeRings(geometry: ParcelOverlayGeometry | null | undefined): {
  rings: Ring[];
  coordinateSystem: ParcelOverlayParams["coordinateSystem"];
} {
  const sourceRings = extractRings(geometry);
  const appearsWebMercator = sourceRings.some((ring) =>
    ring.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90),
  );

  const rings = sourceRings
    .map((ring) => {
      const normalized = appearsWebMercator ? ring.map(webMercatorToWgs84) : ring;
      return closeRing(
        normalized
          .filter(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90)
          .map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]),
      );
    })
    .filter((ring) => ring.length >= 4);

  return {
    rings,
    coordinateSystem: appearsWebMercator ? "web_mercator_converted" : "wgs84",
  };
}

function encodeSigned(value: number): string {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (encoded >= 0x20) {
    output += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }
  return output + String.fromCharCode(encoded + 63);
}

/** Google encoded-polyline format (latitude delta, then longitude delta). */
export function encodePolyline(ring: Ring): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = "";

  for (const [longitude, latitude] of ring) {
    const latitudeE5 = Math.round(latitude * 1e5);
    const longitudeE5 = Math.round(longitude * 1e5);
    encoded += encodeSigned(latitudeE5 - previousLatitude);
    encoded += encodeSigned(longitudeE5 - previousLongitude);
    previousLatitude = latitudeE5;
    previousLongitude = longitudeE5;
  }

  return encoded;
}

function squaredSegmentDistance(point: Position, start: Position, end: Position): number {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDouglasPeucker(points: Ring, tolerance: number): Ring {
  if (points.length <= 3 || tolerance <= 0) return points;
  const squaredTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = squaredTolerance;
    let index = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distance = squaredSegmentDistance(points[i]!, points[first]!, points[last]!);
      if (distance > maxDistance) {
        index = i;
        maxDistance = distance;
      }
    }
    if (index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function simplifyClosedRing(ring: Ring, tolerance: number): Ring {
  const open = ring.slice(0, -1);
  if (open.length <= 3) return ring;

  // Split around the point farthest from the first so a closed ring does not
  // collapse against a zero-length first/last segment.
  const first = open[0]!;
  let splitIndex = 1;
  let maxDistance = 0;
  for (let index = 1; index < open.length; index += 1) {
    const point = open[index]!;
    const distance = (point[0] - first[0]) ** 2 + (point[1] - first[1]) ** 2;
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  const firstHalf = simplifyDouglasPeucker(open.slice(0, splitIndex + 1), tolerance);
  const secondHalf = simplifyDouglasPeucker([...open.slice(splitIndex), first], tolerance).slice(1);
  return closeRing([...firstHalf, ...secondHalf.slice(0, -1)]);
}

function latitudeToWorldY(latitude: number): number {
  const sin = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function fitCenterAndZoom(
  rings: Ring[],
  width: number,
  height: number,
): { center: string; zoom: number; diagonal: number } {
  const points = rings.flat();
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const centerLongitude = (minLongitude + maxLongitude) / 2;
  const centerLatitude = (minLatitude + maxLatitude) / 2;
  const longitudeSpan = Math.max((maxLongitude - minLongitude) / 360, 1e-9);
  const latitudeSpan = Math.max(
    Math.abs(latitudeToWorldY(maxLatitude) - latitudeToWorldY(minLatitude)),
    1e-9,
  );
  const marginFactor = 0.72;
  const longitudeZoom = Math.log2((width * marginFactor) / TILE_SIZE / longitudeSpan);
  const latitudeZoom = Math.log2((height * marginFactor) / TILE_SIZE / latitudeSpan);
  const zoom = Math.max(0, Math.min(21, Math.floor(Math.min(longitudeZoom, latitudeZoom))));
  const diagonal = Math.hypot(maxLongitude - minLongitude, maxLatitude - minLatitude);

  return {
    center: `${centerLatitude.toFixed(6)},${centerLongitude.toFixed(6)}`,
    zoom,
    diagonal,
  };
}

function pathStyle(encoded: string): string {
  return `weight:4|color:0xFFD400FF|fillcolor:0xFFD40018|enc:${encoded}`;
}

function estimateStaticMapUrlLength(
  center: string,
  zoom: number,
  width: number,
  height: number,
  paths: string[],
): number {
  const params = new URLSearchParams({
    center,
    zoom: String(zoom),
    size: `${width}x${height}`,
    maptype: "satellite",
    scale: "2",
    key: "x".repeat(64),
  });
  for (const path of paths) params.append("path", path);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`.length;
}

export function buildParcelOverlayParams(input: {
  geometry: ParcelOverlayGeometry | null | undefined;
  width?: number;
  height?: number;
  maxUrlLength?: number;
}): ParcelOverlayParams | null {
  const width = input.width ?? 640;
  const height = input.height ?? 420;
  const maxUrlLength = Math.min(
    input.maxUrlLength ?? TARGET_URL_LENGTH,
    GOOGLE_STATIC_MAP_MAX_URL_LENGTH,
  );
  const normalized = normalizeRings(input.geometry);
  if (normalized.rings.length === 0) return null;

  const originalPointCount = normalized.rings.reduce((sum, ring) => sum + ring.length, 0);
  const fit = fitCenterAndZoom(normalized.rings, width, height);
  let rings = normalized.rings;
  let paths = rings.map((ring) => pathStyle(encodePolyline(ring)));
  let tolerance = Math.max(fit.diagonal / 100_000, 1e-8);

  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (estimateStaticMapUrlLength(fit.center, fit.zoom, width, height, paths) <= maxUrlLength) {
      break;
    }
    rings = normalized.rings.map((ring) => simplifyClosedRing(ring, tolerance));
    paths = rings.map((ring) => pathStyle(encodePolyline(ring)));
    tolerance *= 2;
  }

  const renderedPointCount = rings.reduce((sum, ring) => sum + ring.length, 0);
  return {
    center: fit.center,
    zoom: fit.zoom,
    paths,
    coordinateSystem: normalized.coordinateSystem,
    originalPointCount,
    renderedPointCount,
    simplified: renderedPointCount < originalPointCount,
  };
}
