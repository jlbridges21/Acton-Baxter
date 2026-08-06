import { describe, expect, it } from "vitest";
import {
  BUILDABLE_ENVELOPE_DISCLAIMER,
  DEGENERATE_ENVELOPE_MESSAGE,
  FRONT_YARD_NOT_MODELED_NOTE,
  computeApproximateBuildableEnvelope,
  formatEnvelopeAreaDisplay,
  formatMaxSizeDisplay,
} from "@/lib/research/buildable-envelope";
import { buildParcelOverlayParams } from "@/lib/providers/google/parcel-overlay";
import { buildSiteInspectionItems } from "@/lib/research/site-inspection";
import type { JurisdictionRule } from "@/lib/jurisdictions";
import type { FullReport } from "@/lib/research/db-types";

function rule(
  overrides: Partial<JurisdictionRule> & Pick<JurisdictionRule, "rule_key" | "value_json">,
): JurisdictionRule {
  return {
    id: overrides.id ?? overrides.rule_key,
    jurisdiction_key: overrides.jurisdiction_key ?? "ca-san-jose",
    rule_key: overrides.rule_key,
    zone_key: overrides.zone_key ?? null,
    value_json: overrides.value_json,
    source_citation: overrides.source_citation ?? "SJMC test §1",
    source_knowledge_entry_id: null,
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** ~100 ft × 50 ft rectangle near San Jose (hand-checkable inset). */
function rectangleParcel100x50(): { type: "Polygon"; coordinates: number[][][] } {
  // 1° lat ≈ 364000 ft; 1° lon ≈ 288500 ft at ~37.25°
  const originLon = -121.935;
  const originLat = 37.25;
  const widthLon = 100 / 288_500;
  const heightLat = 50 / 364_000;
  return {
    type: "Polygon",
    coordinates: [
      [
        [originLon, originLat],
        [originLon + widthLon, originLat],
        [originLon + widthLon, originLat + heightLat],
        [originLon, originLat + heightLat],
        [originLon, originLat],
      ],
    ],
  };
}

function tinyLot(): { type: "Polygon"; coordinates: number[][][] } {
  const originLon = -121.935;
  const originLat = 37.25;
  const widthLon = 6 / 288_500; // ~6 ft
  const heightLat = 6 / 364_000;
  return {
    type: "Polygon",
    coordinates: [
      [
        [originLon, originLat],
        [originLon + widthLon, originLat],
        [originLon + widthLon, originLat + heightLat],
        [originLon, originLat + heightLat],
        [originLon, originLat],
      ],
    ],
  };
}

const sideRear4 = [
  rule({
    rule_key: "adu_setback_front_ft",
    value_json: { kind: "quantity", value: 20, unit: "ft" },
    source_citation: "Front cite",
  }),
  rule({
    rule_key: "adu_setback_side_ft",
    value_json: { kind: "quantity", value: 4, unit: "ft" },
    source_citation: "Side cite",
  }),
  rule({
    rule_key: "adu_setback_rear_ft",
    value_json: { kind: "quantity", value: 4, unit: "ft" },
    source_citation: "Rear cite",
  }),
];

describe("approximate buildable envelope", () => {
  it("insets a rectangle with 4 ft side/rear and reports sane area", () => {
    const result = computeApproximateBuildableEnvelope({
      geometry: rectangleParcel100x50(),
      rules: sideRear4,
      zoning: null,
    });
    expect(result.status).toBe("ok");
    expect(result.insetFeet).toBe(4);
    expect(result.geometry?.type).toBe("Polygon");
    // Ideal rect inset: (100-8)*(50-8) = 3,864 sq ft; allow Turf geodesic tolerance.
    expect(result.areaSqFt).toBeGreaterThan(3_600);
    expect(result.areaSqFt).toBeLessThan(4_100);
    expect(formatEnvelopeAreaDisplay(result.areaSqFt!)).toMatch(/side\/rear setbacks only/);
    expect(result.disclaimer).toBe(BUILDABLE_ENVELOPE_DISCLAIMER);
    expect(result.frontYardNote).toBe(FRONT_YARD_NOT_MODELED_NOTE);
    expect(result.setbacks.front.feet).toBe(20);
    expect(result.setbacks.scopeLabel).toBe("general");
  });

  it("returns honest degenerate message when setbacks consume the lot", () => {
    const result = computeApproximateBuildableEnvelope({
      geometry: tinyLot(),
      rules: sideRear4,
      zoning: null,
    });
    expect(result.status).toBe("degenerate");
    expect(result.geometry).toBeNull();
    expect(result.statusMessage).toBe(DEGENERATE_ENVELOPE_MESSAGE);
  });

  it("buffers each ring of a MultiPolygon", () => {
    const a = rectangleParcel100x50();
    const b = rectangleParcel100x50();
    // Shift second polygon east by ~150 ft.
    const shift = 150 / 288_500;
    b.coordinates[0] = b.coordinates[0]!.map((coord) => {
      const lon = coord[0]!;
      const lat = coord[1]!;
      return [lon + shift, lat];
    });
    const result = computeApproximateBuildableEnvelope({
      geometry: {
        type: "MultiPolygon",
        coordinates: [a.coordinates, b.coordinates],
      },
      rules: sideRear4,
      zoning: null,
    });
    expect(result.status).toBe("ok");
    expect(result.geometry?.type).toBe("MultiPolygon");
    expect(result.areaSqFt).toBeGreaterThan(7_000);
  });

  it("prefers zone-specific setbacks when zoning matches", () => {
    const rules = [
      ...sideRear4,
      rule({
        rule_key: "adu_setback_side_ft",
        zone_key: "R-1-8",
        value_json: { kind: "quantity", value: 5, unit: "ft" },
        source_citation: "Zone side",
      }),
      rule({
        rule_key: "adu_setback_rear_ft",
        zone_key: "R-1-8",
        value_json: { kind: "quantity", value: 5, unit: "ft" },
        source_citation: "Zone rear",
      }),
    ];
    const zone = computeApproximateBuildableEnvelope({
      geometry: rectangleParcel100x50(),
      rules,
      zoning: "R-1-8",
    });
    expect(zone.setbacks.usedZoneSpecificRules).toBe(true);
    expect(zone.setbacks.scopeLabel).toBe("zone-specific");
    expect(zone.insetFeet).toBe(5);

    const general = computeApproximateBuildableEnvelope({
      geometry: rectangleParcel100x50(),
      rules,
      zoning: "R-2",
    });
    expect(general.setbacks.fellBackToGeneralRules).toBe(true);
    expect(general.setbacks.scopeLabel).toBe("general");
    expect(general.insetFeet).toBe(4);
  });

  it("shows honest empty setback state when no rules configured", () => {
    const result = computeApproximateBuildableEnvelope({
      geometry: rectangleParcel100x50(),
      rules: [],
      zoning: "R-1",
    });
    expect(result.status).toBe("no_rules");
    expect(result.statusMessage).toContain("/admin/jurisdictions");
  });

  it("shows max size adjacency without a fit verdict", () => {
    const withMax = computeApproximateBuildableEnvelope({
      geometry: rectangleParcel100x50(),
      rules: [
        ...sideRear4,
        rule({
          rule_key: "adu_max_size_sqft",
          value_json: { kind: "quantity", value: 800, unit: "sq ft" },
          source_citation: "Max size cite",
        }),
      ],
      zoning: null,
    });
    expect(withMax.maxSize?.sqFt).toBe(800);
    expect(formatMaxSizeDisplay(withMax.maxSize!)).toContain("800");
    expect(formatMaxSizeDisplay(withMax.maxSize!)).toContain("Max size cite");
    expect(formatMaxSizeDisplay(withMax.maxSize!).toLowerCase()).not.toMatch(/fit|does not fit/);

    const without = computeApproximateBuildableEnvelope({
      geometry: rectangleParcel100x50(),
      rules: sideRear4,
      zoning: null,
    });
    expect(without.maxSize).toBeNull();
  });
});

describe("parcel overlay envelope path", () => {
  it("includes both parcel and envelope paths when budget allows", () => {
    const parcel = rectangleParcel100x50();
    const envelope = computeApproximateBuildableEnvelope({
      geometry: parcel,
      rules: sideRear4,
      zoning: null,
    });
    expect(envelope.status).toBe("ok");
    const overlay = buildParcelOverlayParams({
      geometry: parcel,
      envelopeGeometry: envelope.geometry,
    });
    expect(overlay).not.toBeNull();
    expect(overlay!.envelopeIncluded).toBe(true);
    expect(overlay!.paths.length).toBeGreaterThanOrEqual(2);
    expect(overlay!.paths.some((path) => path.includes("0x2A9D8F"))).toBe(true);
    expect(overlay!.paths.some((path) => path.includes("0xFFD400"))).toBe(true);
  });

  it("drops envelope before parcel when URL budget is tight", () => {
    const pointCount = 2_000;
    const ring = Array.from({ length: pointCount }, (_, index) => {
      const angle = (index / pointCount) * Math.PI * 2;
      const radius = 0.001 + Math.sin(index * 0.37) * 0.00003;
      return [-121.935 + Math.cos(angle) * radius, 37.25 + Math.sin(angle) * radius] as [
        number,
        number,
      ];
    });
    ring.push(ring[0]!);
    const parcel = { type: "Polygon" as const, coordinates: [ring] };
    const envelope = computeApproximateBuildableEnvelope({
      geometry: parcel,
      rules: sideRear4,
      zoning: null,
    });
    expect(envelope.status).toBe("ok");

    const overlay = buildParcelOverlayParams({
      geometry: parcel,
      envelopeGeometry: envelope.geometry,
      maxUrlLength: 1_200,
    });
    expect(overlay).not.toBeNull();
    expect(overlay!.envelopeDroppedForUrlBudget).toBe(true);
    expect(overlay!.envelopeIncluded).toBe(false);
    expect(overlay!.paths.some((path) => path.includes("0xFFD400"))).toBe(true);
    expect(overlay!.paths.every((path) => !path.includes("0x2A9D8F"))).toBe(true);
  });
});

describe("site inspection buildable area item", () => {
  it("adds verify-buildable-area item with envelope honesty", () => {
    const report = {
      id: "00000000-0000-4000-8000-000000000099",
      input_address: "25 N Avalon Dr, Los Altos, CA",
      standardized_address: "25 N Avalon Dr, Los Altos, CA 94022",
      apn: null,
      facts: [],
      maps_json: null,
      property_profile_url: null,
    } as unknown as FullReport;

    const items = buildSiteInspectionItems(report);
    const item = items.find((row) => row.id === "buildable-area-verify");
    expect(item).toBeDefined();
    expect(item!.description).toMatch(/side\/rear setbacks only/i);
    expect(item!.verifySteps.join(" ")).toMatch(/front setback/i);
    expect(item!.verifySteps.join(" ")).toMatch(/easement/i);
    expect(item!.verifySteps.join(" ")).toMatch(/as a survey/i);
  });
});
