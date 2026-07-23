import "server-only";

import { getEnv } from "@/lib/env";
import {
  googleAutocomplete,
  googleGeocode,
  googlePlaceDetails,
  isGooglePlacesConfigured,
} from "./google-places-client";
import { isRejectableAddressText, selectedAddressFromParts } from "./normalizer";
import type { AddressProvider } from "./provider.interface";
import type { AddressResolveResult, AddressSuggestion, SelectedAddress } from "./types";
import { selectedAddressSchema } from "./schemas";

class GoogleAddressProvider implements AddressProvider {
  readonly key = "google-places";
  readonly name = "Google Places";

  isConfigured(): boolean {
    return isGooglePlacesConfigured();
  }

  autocomplete(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
    return googleAutocomplete(query, signal);
  }

  getPlaceDetails(placeId: string, signal?: AbortSignal): Promise<SelectedAddress> {
    return googlePlaceDetails(placeId, signal);
  }

  geocode(query: string, signal?: AbortSignal): Promise<SelectedAddress[]> {
    return googleGeocode(query, signal);
  }
}

export function getAddressProvider(): AddressProvider {
  return new GoogleAddressProvider();
}

/**
 * Deterministic parse for mock/e2e when Google Places is not configured.
 * Accepts: "Street, City, CA" or "Street, City, CA ZIP"
 */
function resolveWithoutGoogle(input: string): AddressResolveResult {
  const env = getEnv();
  const allowMock =
    env.ENABLE_MOCK_RESEARCH ||
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-");

  if (!allowMock) {
    return {
      status: "rejected",
      message:
        "Address autocomplete is not configured. Ask an admin to add Google Maps keys, or paste a fully formatted address and use Provider Test first.",
    };
  }

  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    return {
      status: "rejected",
      message:
        "We could not confidently identify this property. Please select an address from the suggestions.",
    };
  }

  const street = parts[0]!;
  const city = parts[1]!;
  const stateZip = parts.slice(2).join(" ");
  const stateMatch = stateZip.match(/\b(CA|California)\b/i);
  const zipMatch = stateZip.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (!stateMatch) {
    return {
      status: "rejected",
      message: "Only California addresses are supported",
    };
  }

  const isSample = /655\s+13th/i.test(street) && /san\s*jose/i.test(city);
  const address = selectedAddressFromParts({
    placeId: null,
    formattedAddress: zipMatch ? `${street}, ${city}, CA ${zipMatch[1]}` : `${street}, ${city}, CA`,
    addressLine1: street,
    city,
    state: "CA",
    zipCode: zipMatch?.[1] ?? (isSample ? "95112" : "00000"),
    county: isSample ? "Santa Clara" : null,
    latitude: isSample ? 37.3483 : 36.7783,
    longitude: isSample ? -121.877 : -119.4179,
  });

  const parsed = selectedAddressSchema.safeParse(address);
  if (!parsed.success) {
    return {
      status: "rejected",
      message:
        "We could not confidently identify this property. Please select an address from the suggestions.",
    };
  }

  return { status: "confirmed", address: parsed.data };
}

export async function resolveAddressInput(
  input: string | SelectedAddress,
): Promise<AddressResolveResult> {
  if (typeof input !== "string") {
    const parsed = selectedAddressSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "rejected",
        message: parsed.error.issues[0]?.message ?? "Invalid selected address",
      };
    }
    return { status: "confirmed", address: parsed.data };
  }

  const rejectReason = isRejectableAddressText(input);
  if (rejectReason) {
    return { status: "rejected", message: rejectReason };
  }

  const provider = getAddressProvider();
  if (!provider.isConfigured()) {
    return resolveWithoutGoogle(input);
  }

  const candidates = await provider.geocode(input);
  if (candidates.length === 0) {
    return {
      status: "rejected",
      message:
        "We could not confidently identify this property. Please select an address from the suggestions.",
    };
  }
  if (candidates.length === 1) {
    return { status: "confirmed", address: candidates[0]! };
  }
  return {
    status: "ambiguous",
    candidates: candidates.slice(0, 5),
    message: "Multiple matching addresses were found. Please select the correct property.",
  };
}
