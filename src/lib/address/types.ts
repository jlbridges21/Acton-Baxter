export type SelectedAddress = {
  placeId: string | null;
  formattedAddress: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  county: string | null;
  country: string;
  latitude: number;
  longitude: number;
};

export type AddressSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type AddressResolveResult =
  | { status: "confirmed"; address: SelectedAddress }
  | { status: "ambiguous"; candidates: SelectedAddress[]; message: string }
  | { status: "rejected"; message: string };

export type AddressMatchConfidence = "exact" | "high" | "medium" | "low" | "rejected";
