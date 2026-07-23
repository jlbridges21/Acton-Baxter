import type { AddressSuggestion, SelectedAddress } from "./types";

export interface AddressProvider {
  readonly key: string;
  readonly name: string;
  isConfigured(): boolean;
  autocomplete(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]>;
  getPlaceDetails(placeId: string, signal?: AbortSignal): Promise<SelectedAddress>;
  geocode(query: string, signal?: AbortSignal): Promise<SelectedAddress[]>;
}
