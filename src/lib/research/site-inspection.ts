import type { FullReport } from "@/lib/research/db-types";
import type { NormalizedMaps } from "@/lib/research/schemas";

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
 * Foundation type is intentionally omitted — it is surfaced in Property Overview when ATTOM provides it.
 */
export function buildSiteInspectionItems(report: FullReport): SiteInspectionItem[] {
  const maps = (report.maps_json ?? null) as NormalizedMaps | null;
  const assessorUrl = maps?.assessorUrl ?? maps?.tractMapUrl ?? ASSESSOR_PROPERTY_SEARCH_URL;
  const profileUrl = report.property_profile_url ?? maps?.countyPropertyProfileReportUrl ?? null;

  const easementFacts: SiteInspectionFact[] = [];
  if (report.apn) {
    easementFacts.push({ label: "APN", value: report.apn });
  }
  const tract = factText(report, "tract_number");
  if (tract) {
    easementFacts.push({ label: "Tract / subdivision map number", value: tract });
  }
  const subdivision = factText(report, "subdivision");
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

  return [
    {
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
    },
    {
      id: "easements-tract-maps",
      title: "Easements & recorded tract maps",
      description:
        "Recorded easements and subdivision tract map sheets are not exposed as a reliable public API. Use identifiers below to start title / recorder / survey review — do not treat public GIS as a substitute for recorded documents.",
      verifySteps: [
        "Pull the current title report and recorded easements before relying on buildable area.",
        "Locate the recorded tract / subdivision map via assessor or County Recorder using the APN and tract identifiers.",
        "Confirm access, utility, and setback easements that could constrain an ADU footprint.",
        "Commission a survey when lot lines or easement locations are uncertain.",
      ],
      facts: easementFacts.length > 0 ? easementFacts : undefined,
      links: easementLinks,
    },
  ];
}
