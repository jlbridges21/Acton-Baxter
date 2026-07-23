import { ValidationError } from "@/lib/errors";
import type { SelectedAddress } from "@/lib/address/types";
import { selectedAddressSchema } from "@/lib/address/schemas";
import { resolveAddressInput } from "@/lib/address/resolve";
import { formatSelectedAddressOneLine } from "@/lib/address/normalizer";
import { addressRequestSchema } from "./schemas";
import { REPORT_VERSION } from "./constants";
import { getReportStore } from "./report-store";

export type CreatePropertyReportResult = {
  reportId: string;
  status: "queued";
};

export async function createPropertyReportFromAddress(
  address: SelectedAddress,
  userId: string,
  options?: { parentReportId?: string | null; refreshReason?: string | null },
): Promise<CreatePropertyReportResult> {
  const parsed = selectedAddressSchema.safeParse(address);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid selected address");
  }

  const selected = parsed.data;
  const store = getReportStore();
  const report = await store.createReport({
    createdBy: userId,
    inputAddress: selected.formattedAddress,
    standardizedAddress: formatSelectedAddressOneLine(selected),
    reportVersion: REPORT_VERSION,
    googlePlaceId: selected.placeId,
    addressLine1: selected.addressLine1,
    mailingLocality: selected.city,
    zipCode: selected.zipCode,
    county: selected.county,
    countryCode: selected.country,
    latitude: selected.latitude,
    longitude: selected.longitude,
    parentReportId: options?.parentReportId ?? null,
    refreshReason: options?.refreshReason ?? null,
  });

  return {
    reportId: report.id,
    status: "queued",
  };
}

export async function createPropertyReport(
  address: string,
  userId: string,
): Promise<CreatePropertyReportResult> {
  const parsed = addressRequestSchema.safeParse({ address });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid address");
  }

  const resolved = await resolveAddressInput(parsed.data.address);
  if (resolved.status === "confirmed") {
    return createPropertyReportFromAddress(resolved.address, userId);
  }
  if (resolved.status === "ambiguous") {
    throw new ValidationError(
      "Multiple matching addresses were found. Please select the correct property from suggestions.",
    );
  }
  throw new ValidationError(
    resolved.message ||
      "We could not confidently identify this property. Please select an address from the suggestions.",
  );
}
