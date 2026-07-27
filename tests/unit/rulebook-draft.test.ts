/**
 * Unit tests for Process Rulebook draft editing utilities.
 */

import { describe, it, expect } from "vitest";
import { slugifyKey, ensureUniqueKey } from "@/lib/rulebook/keys";
import { validateParsedRulebook } from "@/lib/rulebook/validator";
import type { ParsedRulebook, ProcessRole } from "@/lib/rulebook/types";

// ============================================================================
// Key slugification tests
// ============================================================================

describe("slugifyKey", () => {
  it("should convert display name to lowercase snake_case", () => {
    expect(slugifyKey("Partnership Evaluation Meeting")).toBe("partnership_evaluation_meeting");
  });

  it("should remove special characters", () => {
    expect(slugifyKey("Client: Site Review (Phase 1)")).toBe("client_site_review_phase_1");
  });

  it("should handle multiple spaces", () => {
    expect(slugifyKey("Some   Text   Here")).toBe("some_text_here");
  });

  it("should trim leading/trailing underscores", () => {
    expect(slugifyKey("  Leading and Trailing  ")).toBe("leading_and_trailing");
  });

  it("should handle already-slugified text", () => {
    expect(slugifyKey("already_slugified")).toBe("already_slugified");
  });

  it("should handle numbers", () => {
    expect(slugifyKey("Step 123")).toBe("step_123");
  });

  it("should collapse multiple underscores", () => {
    expect(slugifyKey("multiple___underscores")).toBe("multiple_underscores");
  });
});

describe("ensureUniqueKey", () => {
  it("should return base key when not in existing set", () => {
    const existingKeys = new Set(["foo", "bar"]);
    expect(ensureUniqueKey("baz", existingKeys)).toBe("baz");
  });

  it("should append _2 when base key exists", () => {
    const existingKeys = new Set(["foo", "bar"]);
    expect(ensureUniqueKey("foo", existingKeys)).toBe("foo_2");
  });

  it("should append _3 when _2 also exists", () => {
    const existingKeys = new Set(["foo", "foo_2"]);
    expect(ensureUniqueKey("foo", existingKeys)).toBe("foo_3");
  });

  it("should find next available number", () => {
    const existingKeys = new Set(["foo", "foo_2", "foo_3", "foo_5"]);
    expect(ensureUniqueKey("foo", existingKeys)).toBe("foo_4");
  });
});

// ============================================================================
// Validation tests
// ============================================================================

describe("validateParsedRulebook", () => {
  const validRulebook: ParsedRulebook = {
    roles: [
      { role_key: "sales_manager", display_name: "Sales Manager" },
      { role_key: "project_manager", display_name: "Project Manager" },
    ],
    stages: [
      {
        stage_key: "pre_sale",
        display_name: "Pre-Sale",
        order_index: 0,
        external_stage_name: "Pre-Sale",
      },
    ],
    steps: [
      {
        step_key: "initial_meeting",
        stage_key: "pre_sale",
        display_name: "Initial Meeting",
        order_index: 0,
      },
    ],
    raci: [{ step_key: "initial_meeting", role_key: "sales_manager", raci: "R" }],
    data_requirements: [],
  };

  it("should validate a valid rulebook", () => {
    const report = validateParsedRulebook(validRulebook);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("should error on missing responsible role", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      raci: [],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "missing_responsible",
        }),
      ]),
    );
  });

  it("should error on multiple responsible roles", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      raci: [
        { step_key: "initial_meeting", role_key: "sales_manager", raci: "R" },
        { step_key: "initial_meeting", role_key: "project_manager", raci: "R" },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "multiple_responsible",
        }),
      ]),
    );
  });

  it("should error on duplicate stage keys", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      stages: [
        {
          stage_key: "pre_sale",
          display_name: "Pre-Sale",
          order_index: 0,
        },
        {
          stage_key: "pre_sale",
          display_name: "Pre-Sale 2",
          order_index: 1,
        },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "duplicate_stage_key",
        }),
      ]),
    );
  });

  it("should error on unknown stage reference", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      steps: [
        {
          step_key: "initial_meeting",
          stage_key: "nonexistent_stage",
          display_name: "Initial Meeting",
          order_index: 0,
        },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "unknown_stage_ref",
        }),
      ]),
    );
  });

  it("should error on unknown role reference", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      raci: [{ step_key: "initial_meeting", role_key: "nonexistent_role", raci: "R" }],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "unknown_role_ref",
        }),
      ]),
    );
  });

  it("should warn on buildertrend source system", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      data_requirements: [
        {
          step_key: "initial_meeting",
          field_key: "bt_field",
          display_name: "BT Field",
          source_system: "buildertrend",
        },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "buildertrend_not_connected",
        }),
      ]),
    );
  });

  it("should warn on retired role used as responsible", () => {
    const roles: ProcessRole[] = [
      {
        id: "1",
        role_key: "sales_manager",
        display_name: "Sales Manager",
        description: null,
        status: "retired",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      },
      {
        id: "2",
        role_key: "project_manager",
        display_name: "Project Manager",
        description: null,
        status: "active",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      },
    ];

    const report = validateParsedRulebook(validRulebook, { roleStatuses: roles });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "retired_role_used",
        }),
      ]),
    );
  });

  it("should error on GHL field missing source_field_path when required", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      data_requirements: [
        {
          step_key: "initial_meeting",
          field_key: "ghl_field",
          display_name: "GHL Field",
          source_system: "ghl",
          required: true,
        },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ghl_missing_path",
        }),
      ]),
    );
  });

  it("should not error on GHL field missing source_field_path when not required", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      data_requirements: [
        {
          step_key: "initial_meeting",
          field_key: "ghl_field",
          display_name: "GHL Field",
          source_system: "ghl",
          required: false,
        },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(true);
  });

  it("should warn on unused role", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      roles: [
        { role_key: "sales_manager", display_name: "Sales Manager" },
        { role_key: "project_manager", display_name: "Project Manager" },
        { role_key: "unused_role", display_name: "Unused Role" },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "unused_role",
          context: { role_key: "unused_role" },
        }),
      ]),
    );
  });

  it("should warn on missing accountable role", () => {
    const report = validateParsedRulebook(validRulebook);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "missing_accountable",
        }),
      ]),
    );
  });

  it("should error on multiple accountable roles", () => {
    const rulebook: ParsedRulebook = {
      ...validRulebook,
      raci: [
        { step_key: "initial_meeting", role_key: "sales_manager", raci: "R" },
        { step_key: "initial_meeting", role_key: "project_manager", raci: "A" },
        { step_key: "initial_meeting", role_key: "sales_manager", raci: "A" },
      ],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(false);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "multiple_accountable",
        }),
      ]),
    );
  });
});

// ============================================================================
// RACI validation logic tests
// ============================================================================

describe("RACI validation logic", () => {
  it("should accept exactly one R and one A per step", () => {
    const rulebook: ParsedRulebook = {
      roles: [
        { role_key: "role_r", display_name: "Role R" },
        { role_key: "role_a", display_name: "Role A" },
      ],
      stages: [{ stage_key: "stage", display_name: "Stage", order_index: 0 }],
      steps: [
        {
          step_key: "step",
          stage_key: "stage",
          display_name: "Step",
          order_index: 0,
        },
      ],
      raci: [
        { step_key: "step", role_key: "role_r", raci: "R" },
        { step_key: "step", role_key: "role_a", raci: "A" },
      ],
      data_requirements: [],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(true);
    const raciErrors = report.errors.filter(
      (e) => e.type === "missing_responsible" || e.type === "multiple_responsible",
    );
    expect(raciErrors).toHaveLength(0);
  });

  it("should allow multiple C and I roles", () => {
    const rulebook: ParsedRulebook = {
      roles: [
        { role_key: "role_r", display_name: "Role R" },
        { role_key: "role_c1", display_name: "Role C1" },
        { role_key: "role_c2", display_name: "Role C2" },
        { role_key: "role_i1", display_name: "Role I1" },
        { role_key: "role_i2", display_name: "Role I2" },
      ],
      stages: [{ stage_key: "stage", display_name: "Stage", order_index: 0 }],
      steps: [
        {
          step_key: "step",
          stage_key: "stage",
          display_name: "Step",
          order_index: 0,
        },
      ],
      raci: [
        { step_key: "step", role_key: "role_r", raci: "R" },
        { step_key: "step", role_key: "role_c1", raci: "C" },
        { step_key: "step", role_key: "role_c2", raci: "C" },
        { step_key: "step", role_key: "role_i1", raci: "I" },
        { step_key: "step", role_key: "role_i2", raci: "I" },
      ],
      data_requirements: [],
    };

    const report = validateParsedRulebook(rulebook);
    expect(report.valid).toBe(true);
  });
});
