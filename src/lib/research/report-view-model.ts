/**
 * Presentation-only view-model shaping for the property report page.
 *
 * Nothing here fetches, computes, or decides anything — it reshapes values that
 * other modules already produced into the section list and at-a-glance chips the
 * report UI renders. Chips must never editorialize: they repeat what a section
 * already says, and say "no data" plainly when a section has nothing.
 */
import { FIELD_KEYS, WUI_CAVEAT } from "./constants";
import type { BuildableEnvelopeResult } from "./buildable-envelope";
import type { FullReport, PropertyFactRow } from "./db-types";

/** Uniform token for a value the sources did not provide. */
export const NO_DATA_LABEL = "No data";

export type ReportSectionId =
  | "at-a-glance"
  | "research-summary"
  | "imagery"
  | "overview"
  | "parcel"
  | "planning-hazards"
  | "fire-access"
  | "adu-code"
  | "site-inspection"
  | "observations"
  | "conflicts"
  | "pem-preparation"
  | "sources"
  | "diagnostics";

export type ReportNavItem = {
  id: ReportSectionId;
  /** Short label for the sticky nav / mobile select. */
  navLabel: string;
};

/**
 * Canonical section order, following the PEM-prep mental model:
 * orient → look at it → what is it → where are the lines → what rules apply →
 * what to check on site → what disagrees → what to bring → where it came from.
 */
const SECTION_ORDER: ReportNavItem[] = [
  { id: "at-a-glance", navLabel: "At a glance" },
  { id: "research-summary", navLabel: "Research summary" },
  { id: "imagery", navLabel: "Imagery & maps" },
  { id: "overview", navLabel: "Property overview" },
  { id: "parcel", navLabel: "Parcel & lot lines" },
  { id: "planning-hazards", navLabel: "Planning & hazards" },
  { id: "fire-access", navLabel: "Fire access" },
  { id: "adu-code", navLabel: "ADU code highlights" },
  { id: "site-inspection", navLabel: "On-site checklist" },
  { id: "observations", navLabel: "Site observations" },
  { id: "conflicts", navLabel: "Inconsistencies" },
  { id: "pem-preparation", navLabel: "PEM preparation" },
  { id: "sources", navLabel: "Sources" },
  { id: "diagnostics", navLabel: "Diagnostics" },
];

/** Keeps the nav in sync with what actually rendered — never links to a missing anchor. */
export function buildReportNavItems(present: Partial<Record<ReportSectionId, boolean>>) {
  return SECTION_ORDER.filter((item) => present[item.id] !== false);
}

export type ReportSummaryChip = {
  id: string;
  label: string;
  /** Short form of the value; `fullValue` keeps whatever the section states. */
  value: string;
  fullValue: string;
  /** Caveat that must travel with the value wherever it is shown. */
  note?: string;
  /**
   * False when the underlying data is absent or deferred to manual review.
   * Rendered as a muted chip — never hidden, so the gap is visible.
   */
  hasValue: boolean;
  targetId: ReportSectionId;
};

const CHIP_VALUE_MAX_CHARS = 56;

/**
 * Hazard values arrive as full sentences ("X — 0.2% annual chance flood hazard
 * (moderate/500-year)"). A chip shows the leading designation and links to the
 * section that states the value in full — it never rewords or re-grades it.
 */
function shortenChipValue(text: string): string {
  let short = text.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const dashIndex = short.indexOf(" — ");
  if (dashIndex > 0) short = short.slice(0, dashIndex).trim();
  if (short.length <= CHIP_VALUE_MAX_CHARS) return short;
  const cut = short.slice(0, CHIP_VALUE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function factFor(facts: PropertyFactRow[], key: string): PropertyFactRow | null {
  return facts.find((fact) => fact.field_key === key) ?? null;
}

function factText(facts: PropertyFactRow[], key: string): string | null {
  const fact = factFor(facts, key);
  const text = fact?.normalized_value_text?.trim();
  if (text) return text;
  if (fact?.normalized_value_number != null) {
    return fact.normalized_value_number.toLocaleString("en-US");
  }
  return null;
}

function lotSizeChipValue(facts: PropertyFactRow[]): string | null {
  const fact = factFor(facts, FIELD_KEYS.lotSqFt);
  if (fact?.normalized_value_number != null) {
    return `${Math.round(fact.normalized_value_number).toLocaleString("en-US")} sq ft`;
  }
  const text = fact?.normalized_value_text?.trim();
  return text ? text : null;
}

function hydrantChipValue(hydrant: {
  status: "ok" | "no_data";
  distanceFt: number | null;
}): string | null {
  if (hydrant.status !== "ok" || hydrant.distanceFt == null) return null;
  return `~${Math.round(hydrant.distanceFt).toLocaleString("en-US")} ft straight-line`;
}

/** Short restatement of the envelope status already spelled out in ADU code highlights. */
function envelopeChip(buildable: BuildableEnvelopeResult | null | undefined): {
  value: string;
  hasValue: boolean;
} {
  if (!buildable) return { value: NO_DATA_LABEL, hasValue: false };
  if (buildable.status === "ok" && buildable.areaSqFt != null) {
    return {
      value: `~${Math.round(buildable.areaSqFt).toLocaleString("en-US")} sq ft (side/rear)`,
      hasValue: true,
    };
  }
  switch (buildable.status) {
    case "degenerate":
      return { value: "Setbacks may consume lot", hasValue: false };
    case "no_geometry":
      return { value: "No parcel geometry", hasValue: false };
    case "no_rules":
      return { value: "No setback rules", hasValue: false };
    case "no_side_rear_rules":
      return { value: "No side/rear setbacks", hasValue: false };
    default:
      return { value: "Not drawn — rules only", hasValue: false };
  }
}

export function buildReportSummaryChips(input: {
  report: FullReport;
  buildable?: BuildableEnvelopeResult | null;
  hydrant: { status: "ok" | "no_data"; distanceFt: number | null };
}): ReportSummaryChip[] {
  const { report, buildable, hydrant } = input;
  const facts = report.facts;

  const jurisdiction = report.jurisdiction_name?.trim() ?? null;
  const zoning = factText(facts, FIELD_KEYS.zoning);
  const lotSize = lotSizeChipValue(facts);
  const floodZone = factText(facts, FIELD_KEYS.floodZone);
  const fireZone = factText(facts, FIELD_KEYS.fireZone);
  const wui = factText(facts, FIELD_KEYS.wuiClassification);
  const hydrantValue = hydrantChipValue(hydrant);
  const envelope = envelopeChip(buildable);
  const conflictCount = report.conflicts.length;

  function chip(input: {
    id: string;
    label: string;
    text: string | null;
    targetId: ReportSectionId;
    missingLabel?: string;
    note?: string;
  }): ReportSummaryChip {
    const hasValue = Boolean(input.text);
    const fullValue = input.text ?? input.missingLabel ?? NO_DATA_LABEL;
    return {
      id: input.id,
      label: input.label,
      value: hasValue ? shortenChipValue(fullValue) : fullValue,
      fullValue,
      hasValue,
      targetId: input.targetId,
      ...(hasValue && input.note ? { note: input.note } : {}),
    };
  }

  return [
    chip({
      id: "jurisdiction",
      label: "Jurisdiction",
      text: jurisdiction,
      missingLabel: "Not mapped",
      targetId: "adu-code",
    }),
    chip({ id: "zoning", label: "Zoning", text: zoning, targetId: "planning-hazards" }),
    chip({ id: "lot-size", label: "Lot size", text: lotSize, targetId: "overview" }),
    chip({ id: "flood-zone", label: "Flood zone", text: floodZone, targetId: "planning-hazards" }),
    chip({
      id: "fire-severity",
      label: "Fire hazard severity",
      text: fireZone,
      targetId: "planning-hazards",
    }),
    chip({
      id: "wui",
      label: "WUI screen",
      text: wui,
      targetId: "planning-hazards",
      note: `${WUI_CAVEAT.charAt(0).toUpperCase()}${WUI_CAVEAT.slice(1)}.`,
    }),
    chip({
      id: "hydrant",
      label: "Nearest hydrant",
      text: hydrantValue,
      targetId: "fire-access",
    }),
    {
      id: "buildable-envelope",
      label: "Buildable envelope",
      value: envelope.value,
      fullValue: envelope.value,
      hasValue: envelope.hasValue,
      targetId: "parcel",
    },
    {
      id: "conflicts",
      label: "Inconsistencies",
      value: conflictCount === 0 ? "None flagged" : `${conflictCount} flagged`,
      fullValue: conflictCount === 0 ? "None flagged" : `${conflictCount} flagged`,
      hasValue: true,
      targetId: "conflicts",
    },
  ];
}
