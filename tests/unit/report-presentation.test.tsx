/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  NO_DATA_LABEL,
  buildReportNavItems,
  buildReportSummaryChips,
  type ReportSectionId,
} from "@/lib/research/report-view-model";
import { ReportSummaryChips } from "@/components/reports/report-summary-chips";
import { ReportNotice, ReportSection } from "@/components/reports/report-section";
import { ImportantInconsistencies } from "@/components/reports/important-inconsistencies";
import { ResearchSummary } from "@/components/reports/research-summary";
import { PlanningAndHazards } from "@/components/reports/planning-and-hazards";
import type { FullReport, PropertyFactRow, ReportConflictRow } from "@/lib/research/db-types";
import type { BuildableEnvelopeResult } from "@/lib/research/buildable-envelope";

function fact(overrides: Partial<PropertyFactRow> & { field_key: string }): PropertyFactRow {
  return {
    id: `fact-${overrides.field_key}`,
    report_id: "report-1",
    category: "characteristics",
    field_label: overrides.field_key,
    normalized_value_text: null,
    normalized_value_number: null,
    normalized_value_boolean: null,
    unit: null,
    preferred_source_name: null,
    preferred_source_url: null,
    confidence: "high",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function report(overrides: Partial<FullReport> = {}): FullReport {
  return {
    id: "report-1",
    created_by: "user-1",
    input_address: "1 Test St, San Jose, CA",
    standardized_address: "1 Test St, San Jose, CA 95112",
    status: "complete",
    jurisdiction_name: "City of San Jose",
    jurisdiction_type: "city",
    county: "Santa Clara",
    state: "CA",
    latitude: 37.3,
    longitude: -121.9,
    apn: "123-45-678",
    summary: "Summary text.",
    report_version: "1.0.0",
    error_message: null,
    started_at: null,
    completed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    facts: [],
    claims: [],
    conflicts: [],
    sources: [],
    parcelGeometry: null,
    siteObservations: [],
    pemPreparation: null,
    ...overrides,
  };
}

function envelope(overrides: Partial<BuildableEnvelopeResult> = {}): BuildableEnvelopeResult {
  return {
    status: "no_rules",
    setbacks: {
      front: { feet: null, citation: null, zoneKey: null },
      side: { feet: null, citation: null, zoneKey: null },
      rear: { feet: null, citation: null, zoneKey: null },
      insetFeet: null,
      usedZoneSpecificRules: false,
      fellBackToGeneralRules: false,
      scopeLabel: "none",
      zoning: null,
    },
    maxSize: null,
    geometry: null,
    areaSqFt: null,
    insetFeet: null,
    statusMessage: null,
    disclaimer: "disclaimer",
    frontYardNote: "front yard note",
    ...overrides,
  };
}

afterEach(cleanup);

describe("at-a-glance summary chips", () => {
  it("reports every high-value fact, using honest no-data chips instead of hiding them", () => {
    const chips = buildReportSummaryChips({
      report: report(),
      buildable: envelope(),
      hydrant: { status: "no_data", distanceFt: null },
    });

    expect(chips.map((chip) => chip.id)).toEqual([
      "jurisdiction",
      "zoning",
      "lot-size",
      "flood-zone",
      "fire-severity",
      "wui",
      "hydrant",
      "buildable-envelope",
      "conflicts",
    ]);

    const byId = new Map(chips.map((chip) => [chip.id, chip]));
    expect(byId.get("zoning")).toMatchObject({ value: NO_DATA_LABEL, hasValue: false });
    expect(byId.get("flood-zone")).toMatchObject({ value: NO_DATA_LABEL, hasValue: false });
    expect(byId.get("hydrant")).toMatchObject({ value: NO_DATA_LABEL, hasValue: false });
    expect(byId.get("buildable-envelope")).toMatchObject({
      value: "No setback rules",
      hasValue: false,
    });
    expect(byId.get("conflicts")).toMatchObject({ value: "None flagged" });
  });

  it("formats populated values and points each chip at a real section anchor", () => {
    const chips = buildReportSummaryChips({
      report: report({
        facts: [
          fact({ field_key: "zoning", normalized_value_text: "R-1-8" }),
          fact({ field_key: "lot_sq_ft", normalized_value_number: 8123.4, unit: "sq ft" }),
          fact({ field_key: "flood_zone", normalized_value_text: "Zone X" }),
          fact({ field_key: "fire_zone", normalized_value_text: "Moderate" }),
          fact({ field_key: "wui_classification", normalized_value_text: "Influence Zone" }),
        ],
        conflicts: [{ id: "c1" } as ReportConflictRow],
      }),
      buildable: envelope({ status: "ok", areaSqFt: 10_996.2, insetFeet: 4 }),
      hydrant: { status: "ok", distanceFt: 1301.4 },
    });

    const byId = new Map(chips.map((chip) => [chip.id, chip]));
    expect(byId.get("lot-size")).toMatchObject({ value: "8,123 sq ft", hasValue: true });
    expect(byId.get("flood-zone")).toMatchObject({ value: "Zone X", hasValue: true });
    expect(byId.get("hydrant")).toMatchObject({
      value: "~1,301 ft straight-line",
      hasValue: true,
    });
    expect(byId.get("buildable-envelope")).toMatchObject({
      value: "~10,996 sq ft (side/rear)",
      hasValue: true,
    });
    expect(byId.get("conflicts")).toMatchObject({ value: "1 flagged" });
    expect(byId.get("wui")?.note).toMatch(/screen-level indicator/i);

    const navIds = new Set(buildReportNavItems({}).map((item) => item.id));
    for (const chip of chips) {
      expect(navIds.has(chip.targetId)).toBe(true);
    }
  });

  it("shortens long hazard sentences for the chip while keeping the full value for the title", () => {
    const chips = buildReportSummaryChips({
      report: report({
        facts: [
          fact({
            field_key: "flood_zone",
            normalized_value_text: "X — 0.2% annual chance flood hazard (moderate/500-year)",
          }),
        ],
      }),
      buildable: envelope(),
      hydrant: { status: "no_data", distanceFt: null },
    });
    const flood = chips.find((chip) => chip.id === "flood-zone")!;
    expect(flood.value).toBe("X");
    expect(flood.fullValue).toContain("0.2% annual chance");
  });

  it("renders chips as anchors that carry their state in the markup", () => {
    render(
      <ReportSummaryChips
        chips={buildReportSummaryChips({
          report: report(),
          buildable: envelope(),
          hydrant: { status: "no_data", distanceFt: null },
        })}
      />,
    );

    const hydrant = document.querySelector('[data-chip="hydrant"]');
    expect(hydrant?.getAttribute("href")).toBe("#fire-access");
    expect(hydrant?.getAttribute("data-chip-has-value")).toBe("false");
    expect(document.querySelectorAll("[data-chip]")).toHaveLength(9);
    // Screen-only: print keeps the card stack where each value already appears.
    expect(document.querySelector("#at-a-glance")?.className).toContain("print:hidden");
  });
});

describe("section navigation", () => {
  it("follows the PEM-prep order and drops sections that render nothing", () => {
    expect(buildReportNavItems({}).map((item) => item.id)).toEqual([
      "at-a-glance",
      "research-summary",
      "imagery",
      "overview",
      "parcel",
      "planning-hazards",
      "fire-access",
      "adu-code",
      "site-inspection",
      "observations",
      "conflicts",
      "pem-preparation",
      "sources",
      "diagnostics",
    ]);

    const trimmed = buildReportNavItems({
      observations: false,
      "site-inspection": false,
      "pem-preparation": false,
      diagnostics: false,
    }).map((item) => item.id);
    expect(trimmed).not.toContain("observations");
    expect(trimmed).not.toContain("diagnostics");
    expect(trimmed).toContain("parcel");
  });
});

describe("section shell and empty states", () => {
  it("anchors each section with its nav id and renders the shared header treatment", () => {
    render(
      <ReportSection
        id={"parcel" as ReportSectionId}
        title="Parcel & lot lines"
        description="What this tells you."
        sourceNote="Source: county GIS."
      >
        <p>body</p>
      </ReportSection>,
    );

    const section = document.querySelector("#parcel");
    expect(section?.getAttribute("data-report-section")).toBe("parcel");
    expect(screen.getByRole("heading", { name: "Parcel & lot lines" })).toBeTruthy();
    expect(screen.getByText("What this tells you.")).toBeTruthy();
    expect(screen.getByText("Source: county GIS.")).toBeTruthy();
  });

  it("uses one visual language for no-data and manual-review states", () => {
    const { container } = render(
      <>
        <ReportNotice>nothing here</ReportNotice>
        <ReportNotice variant="manual-review">do this</ReportNotice>
      </>,
    );
    const [noData, manual] = Array.from(container.children) as HTMLElement[];
    expect(noData!.className).toContain("border-dashed");
    expect(noData!.className).toContain("bg-[var(--acton-gray-50)]");
    expect(manual!.className).toContain("border-amber-200");
    expect(manual!.className).toContain("bg-amber-50/70");
  });

  it("keeps sections present with honest empty states when data is missing", () => {
    render(
      <>
        <ResearchSummary summary={null} />
        <ImportantInconsistencies conflicts={[]} />
        <PlanningAndHazards facts={[]} overlays={[]} />
      </>,
    );

    // A missing summary or zero conflicts must not remove the section the nav links to.
    expect(document.querySelector("#research-summary")).toBeTruthy();
    expect(document.querySelector("#conflicts")).toBeTruthy();
    expect(screen.getByText(/No research summary was generated/)).toBeTruthy();
    expect(screen.getByText(/No meaningful disagreements/)).toBeTruthy();
    // Hazard screens with no value read as "No data", never as a blank cell.
    expect(screen.getAllByText(NO_DATA_LABEL).length).toBeGreaterThanOrEqual(5);
  });
});
