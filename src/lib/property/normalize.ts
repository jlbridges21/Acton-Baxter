export { normalizeApn, apnsEqual, formatApnForDisplay } from "./apn";

export function normalizeCountyForCompare(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+county$/i, "")
    .replace(/\s+/g, " ");
}

export function normalizeZipForCompare(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{5})/);
  return match?.[1] ?? null;
}

export function normalizeBathroomForCompare(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num)) return String(value).trim();
  return String(Math.round(num * 100) / 100);
}
