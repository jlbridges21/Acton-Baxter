export const REPORT_STATUSES = ["queued", "researching", "complete", "failed"] as const;
export const USER_ROLES = ["new_user", "user", "admin", "super_admin"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low", "unavailable"] as const;
export const CONFLICT_SEVERITIES = ["information", "warning", "critical"] as const;
export const SOURCE_TYPES = [
  "licensed_property_api",
  "city_gis",
  "county_gis",
  "state_government",
  "federal_government",
  "public_portal",
  "manual_link",
  "visual_observation",
  "mock",
] as const;
export const MATCH_METHODS = [
  "address",
  "apn",
  "coordinate",
  "parcel_geometry",
  "manual",
  "mock",
] as const;
export const SOURCE_STATUSES = [
  "active",
  "unavailable",
  "error",
  "stale",
  "manual_review",
] as const;

export const RESEARCH_STAGES = [
  "Confirming property address",
  "Identifying parcel and APN",
  "Retrieving property characteristics",
  "Checking city and county GIS",
  "Comparing sources",
  "Preparing PEM research report",
] as const;

export const REPORT_VERSION = "1.0.0";

export const MOCK_REFERENCE_ADDRESS = "655 13th St, San Jose, CA";

export const FIELD_KEYS = {
  apn: "apn",
  lotSqFt: "lot_sq_ft",
  livingAreaSqFt: "living_area_sq_ft",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  stories: "stories",
  yearBuilt: "year_built",
  propertyType: "property_type",
  estimatedValue: "estimated_value",
  assessedValue: "assessed_value",
  lastSaleDate: "last_sale_date",
  lastSalePrice: "last_sale_price",
  ownerName: "owner_name",
  ownerMailingAddress: "owner_mailing_address",
  subdivision: "subdivision",
  tractNumber: "tract_number",
  zoning: "zoning",
  generalPlan: "general_plan",
  historicStatus: "historic_status",
  floodZone: "flood_zone",
  fireZone: "fire_zone",
  wuiClassification: "wui_classification",
  nearestHydrantDistanceFt: "nearest_hydrant_distance_ft",
  latitude: "latitude",
  longitude: "longitude",
  taxRateArea: "tax_rate_area",
  buildingCount: "building_count",
  foundationType: "foundation_type",
} as const;

/** UI qualifier when ATTOM provides foundation type (assessor-derived, incomplete). */
export const FOUNDATION_TYPE_VERIFY_NOTE = "Assessor-derived — verify on site during feasibility.";

/**
 * Mandatory WUI caveat — FRAP documents this as a screen-level relative-risk
 * indicator, not a parcel-level designation. Must appear whenever WUI is shown.
 */
export const WUI_CAVEAT =
  "screen-level indicator — verify parcel-specific WUI status with the local jurisdiction";

export const CONFLICT_THRESHOLDS = {
  lotSizePercent: 3,
  livingAreaPercent: 5,
  yearBuiltYears: 2,
  valueEstimatePercent: 20,
} as const;
