import "server-only";

import { ghlGet } from "../client";
import { ghlPhoneNumbersResponseSchema, type GhlPhoneNumber } from "../types";
import { normalizePhoneNumber } from "../normalize";
import { requireGhlLocationId } from "../config";
import { getCachedReference, setCachedReference } from "../cache";

export async function listPhoneNumbers(
  options: { useCache?: boolean } = {},
): Promise<GhlPhoneNumber[]> {
  const locationId = requireGhlLocationId();

  if (options.useCache !== false) {
    const cached = await getCachedReference<GhlPhoneNumber[]>(locationId, "phone_numbers");
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await ghlGet(`/phone-system/numbers/location/${locationId}`, undefined, {
      injectLocationId: false,
    });
    const parsed = ghlPhoneNumbersResponseSchema.safeParse(response);

    let phoneNumbers: GhlPhoneNumber[];

    if (!parsed.success) {
      console.warn("[GHL Phone Numbers] Response validation warning:", parsed.error.message);
      const raw = response as { numbers?: unknown[]; phoneNumbers?: unknown[] };
      const numbers = raw.numbers ?? raw.phoneNumbers ?? [];
      phoneNumbers = Array.isArray(numbers)
        ? (numbers as Record<string, unknown>[]).map(normalizePhoneNumber)
        : [];
    } else {
      const numbers = parsed.data.numbers ?? parsed.data.phoneNumbers ?? [];
      phoneNumbers = numbers.map((n) => normalizePhoneNumber(n as Record<string, unknown>));
    }

    await setCachedReference(locationId, "phone_numbers", phoneNumbers);
    return phoneNumbers;
  } catch (error) {
    console.warn(
      "[GHL Phone Numbers] API may not be available or endpoint differs:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return [];
  }
}

export async function getPhoneNumberById(
  phoneNumberId: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPhoneNumber | null> {
  const phoneNumbers = await listPhoneNumbers(options);
  return phoneNumbers.find((p) => p.id === phoneNumberId) ?? null;
}

export async function findPhoneNumberByNumber(
  number: string,
  options: { useCache?: boolean } = {},
): Promise<GhlPhoneNumber | null> {
  const phoneNumbers = await listPhoneNumbers(options);
  const cleaned = number.replace(/\D/g, "");
  return phoneNumbers.find((p) => p.phoneNumber.replace(/\D/g, "").includes(cleaned)) ?? null;
}

export async function listActivePhoneNumbers(
  options: { useCache?: boolean } = {},
): Promise<GhlPhoneNumber[]> {
  const phoneNumbers = await listPhoneNumbers(options);
  return phoneNumbers.filter((p) => p.isActive);
}

export async function getPhoneNumberSummary(options: { useCache?: boolean } = {}): Promise<{
  total: number;
  active: number;
  types: Record<string, number>;
  phoneNumbers: Array<{
    id: string;
    phoneNumber: string;
    name: string | null;
    type: string | null;
    isActive: boolean;
  }>;
}> {
  const phoneNumbers = await listPhoneNumbers(options);
  const types: Record<string, number> = {};

  for (const p of phoneNumbers) {
    const type = p.type ?? "unknown";
    types[type] = (types[type] ?? 0) + 1;
  }

  return {
    total: phoneNumbers.length,
    active: phoneNumbers.filter((p) => p.isActive).length,
    types,
    phoneNumbers: phoneNumbers.map((p) => ({
      id: p.id,
      phoneNumber: p.phoneNumber,
      name: p.name,
      type: p.type,
      isActive: p.isActive,
    })),
  };
}
