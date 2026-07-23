export class RentCastError extends Error {
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(message: string, options?: { statusCode?: number | null; retryable?: boolean }) {
    super(message);
    this.name = "RentCastError";
    this.statusCode = options?.statusCode ?? null;
    this.retryable = options?.retryable ?? false;
  }
}

export type RentCastRequestResult<T> = {
  data: T;
  responseTimeMs: number;
  httpStatus: number;
  endpoint: string;
  unavailable?: boolean;
  statusMessage?: string;
};

export type RentCastNormalizedProperty = {
  id: string | null;
  formattedAddress: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaSquareFootage: number | null;
  lotSquareFootage: number | null;
  yearBuilt: number | null;
  stories: number | null;
  pool: boolean | null;
  garage: string | null;
  assessedValue: number | null;
  taxAmount: number | null;
  ownerNames: string | null;
  ownerMailingAddress: string | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  subdivision: string | null;
  matchScore: number;
  matchMethod: "address" | "zip" | "city_state" | "coordinate" | "none";
  raw: unknown;
};
