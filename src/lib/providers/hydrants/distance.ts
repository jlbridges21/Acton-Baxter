const EARTH_RADIUS_FT = 3958.7613 * 5280;

/** Straight-line great-circle distance in feet (lower bound on hose-lay distance). */
export function feetBetween(
  longitude1: number,
  latitude1: number,
  longitude2: number,
  latitude2: number,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRad(latitude1);
  const lat2 = toRad(latitude2);
  const dLat = toRad(latitude2 - latitude1);
  const dLon = toRad(longitude2 - longitude1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Approximate degrees of latitude for a given foot distance. */
export function feetToLatitudeDegrees(feet: number): number {
  return feet / 364000;
}
