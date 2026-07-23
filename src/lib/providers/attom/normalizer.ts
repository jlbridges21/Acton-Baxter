import type { AttomNormalizedProperty, AttomPropertyIdentity } from "./types";

const ACRES_TO_SQ_FT = 43_560;

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["y", "yes", "true", "1"].includes(normalized)) return true;
    if (["n", "no", "false", "0"].includes(normalized)) return false;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nested(root: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function acresToSquareFeet(acres: number | null): number | null {
  if (acres === null || !Number.isFinite(acres)) return null;
  return Math.round(acres * ACRES_TO_SQ_FT);
}

export function normalizeAttomProperty(property: Record<string, unknown>): AttomNormalizedProperty {
  const identifier = asRecord(property.identifier);
  const address = asRecord(property.address);
  const location = asRecord(property.location);
  const summary = asRecord(property.summary);
  const lot = asRecord(property.lot);
  const building = asRecord(property.building);
  const size = asRecord(building.size ?? property.size);
  const rooms = asRecord(building.rooms ?? property.rooms);
  const construction = asRecord(building.construction ?? property.construction);
  const parking = asRecord(building.parking ?? property.parking);
  const assessment = asRecord(property.assessment);
  const assessed = asRecord(assessment.assessed ?? property.assessed);
  const tax = asRecord(assessment.tax ?? property.tax);
  const avm = asRecord(property.avm ?? nested(property, "valuation", "avm") ?? property.valuation);
  const sale = asRecord(
    property.sale ?? nested(property, "salehistory", "0") ?? property.saleHistory,
  );
  const amount = asRecord(sale.amount ?? sale.saleAmount);
  const owner = asRecord(
    property.owner ?? nested(property, "owner", "owner1") ?? property.ownerOwner,
  );
  const mailing = asRecord(owner.mailingaddress ?? owner.mailingAddress ?? owner.mailAddress);

  const lotAcres = toNumber(lot.lotsize1 ?? lot.lotSize1 ?? lot.acres ?? lot.lotacres);
  const lotSqFtDirect = toNumber(
    lot.lotsize2 ?? lot.lotSize2 ?? lot.lotSquareFootage ?? lot.lotsizesquarefeet,
  );
  const livingArea = toNumber(
    size.livingSize ??
      size.livingsize ??
      size.bldgsize ??
      size.universalsize ??
      building.livingSize,
  );
  const bathroomsFull = toNumber(rooms.bathsFull ?? rooms.bathsfull ?? rooms.baths_full);
  const bathroomsPartial = toNumber(rooms.bathsPartial ?? rooms.bathspartial ?? rooms.baths_half);
  const bathroomsTotal =
    toNumber(rooms.bathsTotal ?? rooms.bathstotal ?? rooms.baths) ??
    (bathroomsFull !== null || bathroomsPartial !== null
      ? (bathroomsFull ?? 0) + (bathroomsPartial ?? 0) * 0.5
      : null);

  const ownerFirst = toStringValue(owner.owner1FirstName);
  const ownerLast = toStringValue(owner.owner1LastName);
  const ownerNames =
    toStringValue(owner.owner1FullName ?? owner.owner1fullnamename ?? owner.name) ??
    ([ownerFirst, ownerLast].filter(Boolean).join(" ") || null);

  const mailingAddress = [
    toStringValue(mailing.address1 ?? mailing.line1 ?? mailing.address),
    toStringValue(mailing.address2 ?? mailing.line2),
    [toStringValue(mailing.city), toStringValue(mailing.state), toStringValue(mailing.zip)]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const avmAmount = asRecord(avm.amount);

  const identity: AttomPropertyIdentity = {
    attomId: toStringValue(identifier.attomId ?? identifier.Id ?? identifier.id),
    apn: toStringValue(identifier.apn ?? identifier.APN),
    originalApn: toStringValue(identifier.apnOrig ?? identifier.originalApn),
    fips: toStringValue(identifier.fips ?? identifier.FIPS),
    oneLineAddress: toStringValue(address.oneLine ?? address.line1),
    addressLine1: toStringValue(address.line1 ?? address.address1),
    locality: toStringValue(address.locality ?? address.city),
    county: toStringValue(address.county ?? location.county ?? summary.county),
    state: toStringValue(address.countrySubd ?? address.state ?? address.countrySecSubd),
    zipCode: toStringValue(address.postal1 ?? address.zip),
    latitude: toNumber(location.latitude ?? location.lat),
    longitude: toNumber(location.longitude ?? location.lon ?? location.lng),
    matchCode: toStringValue(address.matchCode ?? location.geoId ?? summary.propClass),
    publicationDate: toStringValue(summary.propLandUse ?? summary.pubDate ?? property.obPropId),
    lastModified: toStringValue(summary.propIndicator ?? summary.lastModified),
  };

  return {
    identity,
    propertyType: toStringValue(summary.propType ?? summary.propertyType ?? building.propertyType),
    propertySubtype: toStringValue(summary.propLandUse ?? summary.propSubtype),
    landUseCode: toStringValue(summary.propLandUse ?? summary.propIndicator),
    lotAcres,
    lotSquareFootage: lotSqFtDirect ?? acresToSquareFeet(lotAcres),
    livingAreaSquareFootage: livingArea,
    grossAreaSquareFootage: toNumber(size.grossSize ?? size.bldgSize ?? size.universalsize),
    bedrooms: toNumber(rooms.beds ?? rooms.bedrooms),
    bathroomsFull,
    bathroomsPartial,
    bathroomsTotal,
    stories: toNumber(
      building.stories ?? building.levels ?? asRecord(building.summary).levels ?? size.stories,
    ),
    yearBuilt: toNumber(summary.yearBuilt ?? building.yearBuilt),
    buildingCount: toNumber(building.bldgCount ?? building.buildingCount ?? summary.bldgCount),
    pool: toBoolean(lot.poolInd ?? building.pool ?? summary.pool),
    constructionType: toStringValue(construction.condition ?? construction.constructionType),
    foundationType: toStringValue(construction.foundationType ?? building.foundationType),
    roofType: toStringValue(construction.roofCover ?? building.roofType),
    heating: toStringValue(building.heatingType ?? construction.heatingType),
    cooling: toStringValue(building.coolingType ?? construction.coolingType),
    garage: toStringValue(parking.prkgType ?? parking.garageType ?? building.parkingType),
    legalDescription: toStringValue(lot.legalDescription ?? lot.legaldescn),
    subdivision: toStringValue(lot.subdivision ?? address.subdivision),
    block: toStringValue(lot.block),
    tract: toStringValue(lot.tractNumber ?? lot.tract),
    assessedValueTotal: toNumber(
      assessed.assdTtlValue ?? assessed.total ?? assessment.assessedValue,
    ),
    assessedValueLand: toNumber(assessed.assdLandValue ?? assessed.land),
    assessedValueImprovement: toNumber(assessed.assdImprValue ?? assessed.improvement),
    taxAmount: toNumber(tax.taxAmt ?? tax.amount ?? assessment.taxAmount),
    assessmentYear: toNumber(assessment.assessorYear ?? assessed.year),
    taxYear: toNumber(tax.taxYear ?? assessment.taxYear),
    estimatedValue: toNumber(avmAmount.value ?? nested(avm, "amount", "value") ?? avm.value),
    estimatedValueLow: toNumber(avmAmount.low ?? nested(avm, "amount", "low") ?? avm.low),
    estimatedValueHigh: toNumber(avmAmount.high ?? nested(avm, "amount", "high") ?? avm.high),
    avmConfidence: toNumber(avm.eventDate ?? avm.confidenceScore ?? avm.scr),
    avmDate: toStringValue(avm.eventDate ?? avm.avmDate ?? avm.date),
    lastSaleDate: toStringValue(sale.saleSearchDate ?? sale.saleTransDate ?? sale.saleDate),
    lastSaleAmount: toNumber(amount.saleAmt ?? amount.saleTransAmount ?? sale.amount),
    recordingDate: toStringValue(sale.saleRecDate ?? sale.recordingDate),
    documentNumber: toStringValue(sale.saleDocNum ?? sale.documentNumber),
    documentType: toStringValue(sale.saleDocType ?? sale.documentType),
    ownerNames,
    ownerOccupied: toBoolean(owner.ownerOccupied ?? summary.absenteeInd),
    ownerMailingAddress: mailingAddress || null,
    raw: property,
  };
}

export function mergeAttomPackages(
  base: AttomNormalizedProperty,
  extras: Partial<AttomNormalizedProperty>[],
): AttomNormalizedProperty {
  return extras.reduce<AttomNormalizedProperty>((acc, extra) => {
    const merged = { ...acc };
    for (const [key, value] of Object.entries(extra)) {
      if (key === "identity" && value && typeof value === "object") {
        merged.identity = { ...merged.identity, ...(value as AttomPropertyIdentity) };
        continue;
      }
      if (key === "raw") continue;
      if (value !== null && value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  }, base);
}
