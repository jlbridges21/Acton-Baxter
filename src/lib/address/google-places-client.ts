import "server-only";

import { getEnv } from "@/lib/env";
import { AddressError } from "./errors";
import { selectedAddressFromParts } from "./normalizer";
import type { AddressSuggestion, SelectedAddress } from "./types";

type GooglePrediction = {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
  types?: string[];
};

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

function googleKey(): string {
  const env = getEnv();
  return (
    env.GOOGLE_MAPS_SERVER_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  );
}

function component(
  components: GoogleAddressComponent[],
  type: string,
  short = false,
): string | null {
  const match = components.find((item) => item.types.includes(type));
  if (!match) return null;
  return short ? match.short_name : match.long_name;
}

export function isGooglePlacesConfigured(): boolean {
  return Boolean(googleKey() || getEnv().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
}

export async function googleAutocomplete(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const key = googleKey();
  if (!key) return [];

  const params = new URLSearchParams({
    input: query,
    key,
    types: "address",
    components: "country:us",
    location: "37.3382,-121.8863",
    radius: "200000",
  });

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
    { signal },
  );
  if (!response.ok) {
    throw new AddressError("Address suggestions are temporarily unavailable", {
      statusCode: 502,
      code: "GOOGLE_AUTOCOMPLETE_FAILED",
    });
  }
  const data = (await response.json()) as {
    status: string;
    predictions?: GooglePrediction[];
    error_message?: string;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new AddressError(data.error_message ?? "Address autocomplete failed", {
      statusCode: 502,
      code: "GOOGLE_AUTOCOMPLETE_STATUS",
    });
  }

  return (data.predictions ?? [])
    .filter((item) => {
      const text = item.description.toLowerCase();
      return text.includes("ca") || text.includes("california");
    })
    .slice(0, 8)
    .map((item) => ({
      placeId: item.place_id,
      description: item.description,
      mainText: item.structured_formatting?.main_text ?? item.description,
      secondaryText: item.structured_formatting?.secondary_text ?? "",
    }));
}

export async function googlePlaceDetails(
  placeId: string,
  signal?: AbortSignal,
): Promise<SelectedAddress> {
  const key = googleKey();
  if (!key) {
    throw new AddressError("Google Maps is not configured", {
      statusCode: 503,
      code: "GOOGLE_NOT_CONFIGURED",
    });
  }

  const params = new URLSearchParams({
    place_id: placeId,
    key,
    fields: "address_component,formatted_address,geometry,place_id",
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?${params}`,
    { signal },
  );
  if (!response.ok) {
    throw new AddressError("Unable to resolve selected address", { statusCode: 502 });
  }
  const data = (await response.json()) as {
    status: string;
    result?: {
      place_id: string;
      formatted_address: string;
      address_components: GoogleAddressComponent[];
      geometry?: { location?: { lat: number; lng: number } };
    };
  };
  if (data.status !== "OK" || !data.result) {
    throw new AddressError("Unable to resolve selected address", { statusCode: 404 });
  }

  const components = data.result.address_components ?? [];
  const streetNumber = component(components, "street_number") ?? "";
  const route = component(components, "route") ?? "";
  const addressLine1 = `${streetNumber} ${route}`.trim();
  if (!streetNumber || !route) {
    throw new AddressError("Please select a street address, not a city or landmark.", {
      statusCode: 400,
      code: "NOT_STREET_ADDRESS",
    });
  }

  const lat = data.result.geometry?.location?.lat;
  const lng = data.result.geometry?.location?.lng;
  if (lat == null || lng == null) {
    throw new AddressError("Selected address is missing coordinates", { statusCode: 502 });
  }

  return selectedAddressFromParts({
    placeId: data.result.place_id,
    formattedAddress: data.result.formatted_address,
    addressLine1,
    city:
      component(components, "locality") ??
      component(components, "sublocality") ??
      component(components, "postal_town") ??
      "",
    state: component(components, "administrative_area_level_1", true) ?? "CA",
    zipCode: component(components, "postal_code") ?? "",
    county: component(components, "administrative_area_level_2"),
    country: component(components, "country", true) ?? "US",
    latitude: lat,
    longitude: lng,
  });
}

export async function googleGeocode(
  query: string,
  signal?: AbortSignal,
): Promise<SelectedAddress[]> {
  const key = googleKey();
  if (!key) return [];

  const params = new URLSearchParams({
    address: query,
    key,
    components: "country:US|administrative_area:CA",
  });
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal,
  });
  if (!response.ok) {
    throw new AddressError("Address lookup failed", { statusCode: 502 });
  }
  const data = (await response.json()) as {
    status: string;
    results?: Array<{
      place_id: string;
      formatted_address: string;
      types: string[];
      address_components: GoogleAddressComponent[];
      geometry?: { location?: { lat: number; lng: number }; location_type?: string };
      partial_match?: boolean;
    }>;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new AddressError("Address lookup failed", { statusCode: 502 });
  }

  return (data.results ?? [])
    .filter((result) => result.types.includes("street_address") || result.types.includes("premise"))
    .filter((result) => result.geometry?.location)
    .map((result) => {
      const components = result.address_components;
      const streetNumber = component(components, "street_number") ?? "";
      const route = component(components, "route") ?? "";
      return selectedAddressFromParts({
        placeId: result.place_id,
        formattedAddress: result.formatted_address,
        addressLine1: `${streetNumber} ${route}`.trim(),
        city: component(components, "locality") ?? component(components, "postal_town") ?? "",
        state: component(components, "administrative_area_level_1", true) ?? "CA",
        zipCode: component(components, "postal_code") ?? "",
        county: component(components, "administrative_area_level_2"),
        country: component(components, "country", true) ?? "US",
        latitude: result.geometry!.location!.lat,
        longitude: result.geometry!.location!.lng,
      });
    })
    .filter((item) => item.addressLine1 && item.city && item.zipCode);
}
