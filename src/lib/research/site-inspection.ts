import type { FullReport } from "@/lib/research/db-types";
import type { NormalizedMaps } from "@/lib/research/schemas";
import { FIELD_KEYS } from "@/lib/research/constants";
import {
  buildCountySurveyorRecordIndexUrl,
  buildRecorderResearchUrl,
} from "@/lib/connectors/california/santa-clara-county/property-profile";

export type SiteInspectionLink = {
  label: string;
  href: string;
};

export type SiteInspectionFact = {
  label: string;
  value: string;
};

/**
 * Props-driven item for the Site Inspection Required report section.
 * Later automation work moves categories out by omitting them from the items array.
 */
export type SiteInspectionItem = {
  id: string;
  title: string;
  description: string;
  verifySteps: string[];
  facts?: SiteInspectionFact[];
  links?: SiteInspectionLink[];
};

const ASSESSOR_PROPERTY_SEARCH_URL =
  "https://asr.santaclaracounty.gov/online-services/property-search/real-property";

function factText(report: FullReport, fieldKey: string): string | null {
  const fact = report.facts.find((item) => item.field_key === fieldKey);
  const text = fact?.normalized_value_text?.trim();
  return text ? text : null;
}

/**
 * Seed Site Inspection Required items for categories that are not automatable today.
 * Foundation type appears here when ATTOM did not supply a value (including RentCast-only mode).
 */
export function buildSiteInspectionItems(report: FullReport): SiteInspectionItem[] {
  const maps = (report.maps_json ?? null) as NormalizedMaps | null;
  const assessorUrl = maps?.assessorUrl ?? maps?.tractMapUrl ?? ASSESSOR_PROPERTY_SEARCH_URL;
  const profileUrl = report.property_profile_url ?? maps?.countyPropertyProfileReportUrl ?? null;

  const items: SiteInspectionItem[] = [];

  if (!factText(report, FIELD_KEYS.foundationType)) {
    items.push({
      id: "foundation-type",
      title: "Foundation type",
      description:
        "Slab vs pier-and-grade-beam (and similar) is not available from RentCast. ATTOM sometimes provided an assessor-derived value; without ATTOM this must be confirmed on site.",
      verifySteps: [
        "Observe foundation type during site walk (slab, raised / pier and grade beam, or mixed).",
        "Note any crawlspace access, settlement, or prior foundation work visible from outside.",
        "Confirm with a structural or feasibility inspection before relying on foundation assumptions for ADU design.",
      ],
    });
  }

  items.push({
    id: "utilities",
    title: "Utilities",
    description:
      "Electric panel capacity, meter locations, and service laterals are not available from licensed property data or public GIS.",
    verifySteps: [
      "Confirm electric panel amperage and available breaker space on site.",
      "Locate water meter, gas meter, and sewer cleanouts.",
      "Note overhead vs underground service and any apparent capacity limits.",
      "Follow up with the serving utilities when capacity is unclear.",
    ],
  });

  const easementFacts: SiteInspectionFact[] = [];
  if (report.apn) {
    easementFacts.push({ label: "APN", value: report.apn });
  }
  const tract = factText(report, FIELD_KEYS.tractNumber);
  if (tract) {
    easementFacts.push({ label: "Tract / map number (bonus identifier)", value: tract });
  }
  const subdivision = factText(report, FIELD_KEYS.subdivision);
  if (subdivision) {
    easementFacts.push({ label: "Subdivision", value: subdivision });
  }

  const easementLinks: SiteInspectionLink[] = [
    { label: "County assessor property search", href: assessorUrl },
  ];
  if (profileUrl) {
    easementLinks.push({
      label: "County Property Profile / Explorer",
      href: profileUrl,
    });
  }
  easementLinks.push(
    {
      label: "County Surveyor recorded-map index",
      href: buildCountySurveyorRecordIndexUrl(),
    },
    {
      label: "Clerk-Recorder recorded-document research",
      href: buildRecorderResearchUrl(),
    },
  );

  const propertyReference = report.apn
    ? `APN ${report.apn}`
    : `the property address (${report.standardized_address ?? report.input_address})`;
  const subdivisionReference = subdivision
    ? `; subdivision “${subdivision}” may help narrow the map search`
    : "";
  const tractReference = tract ? `; tract/map number ${tract} is an additional search key` : "";
  const profileReference = profileUrl ? " and County Property Explorer" : "";

  items.push({
    id: "easements-tract-maps",
    title: "Easements & recorded tract maps",
    description:
      "Baxter cannot determine recorded easements automatically. Public parcel GIS shows an approximate boundary, not legal easement rights; the verified path is County Surveyor / Clerk-Recorder research plus title and, when needed, survey review.",
    verifySteps: [
      `Confirm ${propertyReference} in the County Assessor search${profileReference}${subdivisionReference}${tractReference}.`,
      `Open the County Surveyor recorded-map index and locate the parcel / subdivision map using ${propertyReference} and the parcel location; save the relevant recorded map reference.`,
      `Review the current preliminary title report for recorded easements. Use the Clerk-Recorder research instructions with ${propertyReference} plus any document, book/page, subdivision, or map references to obtain the actual recorded documents.`,
      "Confirm visible access and utility conditions on site. If an easement or lot line could affect ADU placement, have the title company or a licensed surveyor plot it before relying on buildable area.",
    ],
    facts: easementFacts.length > 0 ? easementFacts : undefined,
    links: easementLinks,
  });

  return items;
}
