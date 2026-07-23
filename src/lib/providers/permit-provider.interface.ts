import type { PropertyLookupInput } from "@/lib/research/types";

export type PermitRecord = {
  permitNumber: string;
  description: string;
  status: string;
  appliedDate?: string | null;
  issuedDate?: string | null;
  finalDate?: string | null;
  sourceUrl?: string | null;
};

export interface PermitProvider {
  readonly key: string;
  readonly name: string;
  searchPermits(input: PropertyLookupInput): Promise<PermitRecord[]>;
  getPermitSearchLink(input: PropertyLookupInput): string | null;
}
