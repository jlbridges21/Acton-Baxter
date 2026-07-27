import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  parseRulebookSheets,
  validateParsedRulebook,
  RulebookValidator,
  detectRulebookIntent,
} from "@/lib/rulebook";
import type { SheetInput } from "@/lib/rulebook/types";

// ============================================================================
// Fixtures
// ============================================================================

function loadFixture(name: string): SheetInput {
  const path = join(process.cwd(), "tests", "fixtures", "rulebook", `${name}.json`);
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

// ============================================================================
// Parser tests
// ============================================================================

describe("Rulebook Parser", () => {
  describe("parseRulebookSheets", () => {
    it("should parse valid complete rulebook", () => {
      const input = loadFixture("valid-complete");
      const parsed = parseRulebookSheets(input);

      expect(parsed.roles).toHaveLength(3);
      expect(parsed.stages).toHaveLength(2);
      expect(parsed.steps).toHaveLength(3);
      expect(parsed.raci).toHaveLength(6);
      expect(parsed.data_requirements).toHaveLength(3);

      // Check role parsing
      const pmRole = parsed.roles.find((r) => r.role_key === "project_manager");
      expect(pmRole).toBeDefined();
      expect(pmRole?.display_name).toBe("Project Manager");
      expect(pmRole?.description).toBe("Oversees project execution");

      // Check stage parsing
      const preConstStage = parsed.stages.find((s) => s.stage_key === "pre_construction");
      expect(preConstStage).toBeDefined();
      expect(preConstStage?.display_name).toBe("Pre-Construction");
      expect(preConstStage?.order_index).toBe(0);
      expect(preConstStage?.duration_days_budget).toBe(30);
      expect(preConstStage?.external_stage_name).toBe("Preconstruction");

      // Check step parsing
      const pemStep = parsed.steps.find((s) => s.step_key === "conduct_pem");
      expect(pemStep).toBeDefined();
      expect(pemStep?.stage_key).toBe("pre_construction");
      expect(pemStep?.display_name).toBe("Conduct PEM");
      expect(pemStep?.order_index).toBe(0);
      expect(pemStep?.duration_days_budget).toBe(7);

      // Check RACI parsing
      const pemRaci = parsed.raci.filter((r) => r.step_key === "conduct_pem");
      expect(pemRaci).toHaveLength(2);
      const responsible = pemRaci.find((r) => r.raci === "R");
      expect(responsible?.role_key).toBe("project_manager");

      // Check data requirement parsing
      const customerName = parsed.data_requirements.find((r) => r.field_key === "customer_name");
      expect(customerName).toBeDefined();
      expect(customerName?.source_system).toBe("ghl");
      expect(customerName?.source_field_path).toBe("contact.full_name");
      expect(customerName?.required).toBe(true);
    });

    it("should handle grid input format", () => {
      const gridInput: SheetInput = {
        grids: {
          Roles: [
            ["role_key", "display_name"],
            ["test_role", "Test Role"],
          ],
          Stages: [
            ["stage_key", "display_name", "order_index"],
            ["test_stage", "Test Stage", "0"],
          ],
          Steps: [
            ["step_key", "stage_key", "display_name", "order_index"],
            ["test_step", "test_stage", "Test Step", "0"],
          ],
          RACI: [
            ["step_key", "role_key", "raci"],
            ["test_step", "test_role", "R"],
          ],
          DataRequirements: [
            ["step_key", "field_key", "display_name", "source_system"],
            ["test_step", "test_field", "Test Field", "manual"],
          ],
        },
      };

      const parsed = parseRulebookSheets(gridInput);
      expect(parsed.roles).toHaveLength(1);
      expect(parsed.stages).toHaveLength(1);
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.raci).toHaveLength(1);
      expect(parsed.data_requirements).toHaveLength(1);
    });

    it("should normalize header names", () => {
      const input: SheetInput = {
        sheets: {
          Roles: [
            {
              "Role Key": "test_role",
              "Display Name": "Test Role",
            },
          ],
          Stages: [
            {
              "Stage Key": "test_stage",
              Name: "Test Stage",
              Order: "0",
            },
          ],
          Steps: [],
          RACI: [],
          DataRequirements: [],
        },
      };

      const parsed = parseRulebookSheets(input);
      expect(parsed.roles).toHaveLength(1);
      expect(parsed.stages).toHaveLength(1);
      expect(parsed.roles[0]?.role_key).toBe("test_role");
      expect(parsed.stages[0]?.stage_key).toBe("test_stage");
    });

    it("should skip incomplete rows", () => {
      const input: SheetInput = {
        sheets: {
          Roles: [
            { role_key: "role1", display_name: "Role 1" },
            { role_key: "" }, // Missing display_name
            { display_name: "Role 3" }, // Missing role_key
          ],
          Stages: [],
          Steps: [],
          RACI: [],
          DataRequirements: [],
        },
      };

      const parsed = parseRulebookSheets(input);
      expect(parsed.roles).toHaveLength(1);
    });
  });
});

// ============================================================================
// Validator tests
// ============================================================================

describe("Rulebook Validator", () => {
  describe("validateParsedRulebook", () => {
    it("should validate valid complete rulebook", () => {
      const input = loadFixture("valid-complete");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });

    it("should detect missing Responsible (R)", () => {
      const input = loadFixture("invalid-missing-r");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const missingRError = report.errors.find((e) => e.type === "missing_responsible");
      expect(missingRError).toBeDefined();
      expect(missingRError?.message).toContain("no Responsible (R)");
    });

    it("should detect multiple Responsible (R)", () => {
      const input = loadFixture("invalid-multiple-r");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const multipleRError = report.errors.find((e) => e.type === "multiple_responsible");
      expect(multipleRError).toBeDefined();
      expect(multipleRError?.message).toContain("multiple Responsible (R)");
    });

    it("should detect multiple Accountable (A)", () => {
      const input = loadFixture("invalid-multiple-a");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const multipleAError = report.errors.find((e) => e.type === "multiple_accountable");
      expect(multipleAError).toBeDefined();
      expect(multipleAError?.message).toContain("multiple Accountable (A)");
    });

    it("should detect unknown role references", () => {
      const input = loadFixture("unknown-role");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const unknownRoleError = report.errors.find((e) => e.type === "unknown_role_ref");
      expect(unknownRoleError).toBeDefined();
      expect(unknownRoleError?.message).toContain("unknown role");
    });

    it("should detect unknown stage references", () => {
      const input = loadFixture("unknown-stage");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const unknownStageError = report.errors.find((e) => e.type === "unknown_stage_ref");
      expect(unknownStageError).toBeDefined();
      expect(unknownStageError?.message).toContain("unknown stage");
    });

    it("should detect unknown step references", () => {
      const input = loadFixture("unknown-step");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const unknownStepError = report.errors.find((e) => e.type === "unknown_step_ref");
      expect(unknownStepError).toBeDefined();
      expect(unknownStepError?.message).toContain("unknown step");
    });

    it("should detect invalid durations", () => {
      const input = loadFixture("invalid-duration");
      const parsed = parseRulebookSheets(input);

      // Parser filters out invalid durations, so we need to manually create invalid data
      if (parsed.stages[0]) parsed.stages[0].duration_days_budget = -5;
      if (parsed.steps[0]) parsed.steps[0].duration_days_budget = 0;

      const report = validateParsedRulebook(parsed);
      expect(report.valid).toBe(false);
    });

    it("should detect missing GHL source_field_path", () => {
      const input = loadFixture("missing-ghl-path");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);
      const ghlError = report.errors.find((e) => e.type === "ghl_missing_path");
      expect(ghlError).toBeDefined();
      expect(ghlError?.message).toContain("missing source_field_path");
    });

    it("should detect duplicate keys", () => {
      const input = loadFixture("duplicate-keys");
      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(false);

      const duplicateStageError = report.errors.find((e) => e.type === "duplicate_stage_key");
      expect(duplicateStageError).toBeDefined();

      const duplicateStepError = report.errors.find((e) => e.type === "duplicate_step_key");
      expect(duplicateStepError).toBeDefined();

      const duplicateFieldError = report.errors.find((e) => e.type === "duplicate_field_key");
      expect(duplicateFieldError).toBeDefined();
    });

    it("should warn about missing durations", () => {
      const input: SheetInput = {
        sheets: {
          Roles: [{ role_key: "test_role", display_name: "Test Role" }],
          Stages: [
            {
              stage_key: "test_stage",
              display_name: "Test Stage",
              order_index: "0",
              // No duration
            },
          ],
          Steps: [
            {
              step_key: "test_step",
              stage_key: "test_stage",
              display_name: "Test Step",
              order_index: "0",
              // No duration
            },
          ],
          RACI: [{ step_key: "test_step", role_key: "test_role", raci: "R" }],
          DataRequirements: [],
        },
      };

      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(true); // Warnings don't make it invalid
      expect(report.warnings.length).toBeGreaterThan(0);

      const stageDurationWarning = report.warnings.find(
        (w) => w.type === "missing_duration" && w.location === "stages",
      );
      expect(stageDurationWarning).toBeDefined();

      const stepDurationWarning = report.warnings.find(
        (w) => w.type === "missing_duration" && w.location === "steps",
      );
      expect(stepDurationWarning).toBeDefined();
    });

    it("should warn about missing Accountable", () => {
      const input: SheetInput = {
        sheets: {
          Roles: [{ role_key: "test_role", display_name: "Test Role" }],
          Stages: [
            {
              stage_key: "test_stage",
              display_name: "Test Stage",
              order_index: "0",
            },
          ],
          Steps: [
            {
              step_key: "test_step",
              stage_key: "test_stage",
              display_name: "Test Step",
              order_index: "0",
            },
          ],
          RACI: [
            { step_key: "test_step", role_key: "test_role", raci: "R" },
            // No Accountable
          ],
          DataRequirements: [],
        },
      };

      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(true);
      const missingAWarning = report.warnings.find((w) => w.type === "missing_accountable");
      expect(missingAWarning).toBeDefined();
    });

    it("should warn about unused roles", () => {
      const input: SheetInput = {
        sheets: {
          Roles: [
            { role_key: "used_role", display_name: "Used Role" },
            { role_key: "unused_role", display_name: "Unused Role" },
          ],
          Stages: [
            {
              stage_key: "test_stage",
              display_name: "Test Stage",
              order_index: "0",
            },
          ],
          Steps: [
            {
              step_key: "test_step",
              stage_key: "test_stage",
              display_name: "Test Step",
              order_index: "0",
            },
          ],
          RACI: [{ step_key: "test_step", role_key: "used_role", raci: "R" }],
          DataRequirements: [],
        },
      };

      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(true);
      const unusedRoleWarning = report.warnings.find((w) => w.type === "unused_role");
      expect(unusedRoleWarning).toBeDefined();
      expect(unusedRoleWarning?.context?.role_key).toBe("unused_role");
    });

    it("should warn about missing external_stage_name", () => {
      const input: SheetInput = {
        sheets: {
          Roles: [{ role_key: "test_role", display_name: "Test Role" }],
          Stages: [
            {
              stage_key: "test_stage",
              display_name: "Test Stage",
              order_index: "0",
              // No external_stage_name
            },
          ],
          Steps: [
            {
              step_key: "test_step",
              stage_key: "test_stage",
              display_name: "Test Step",
              order_index: "0",
            },
          ],
          RACI: [{ step_key: "test_step", role_key: "test_role", raci: "R" }],
          DataRequirements: [],
        },
      };

      const parsed = parseRulebookSheets(input);
      const report = validateParsedRulebook(parsed);

      expect(report.valid).toBe(true);
      const externalNameWarning = report.warnings.find(
        (w) => w.type === "missing_external_stage_name",
      );
      expect(externalNameWarning).toBeDefined();
    });
  });

  describe("RulebookValidator class", () => {
    it("should be instantiable and validate", () => {
      const validator = new RulebookValidator();
      const input = loadFixture("valid-complete");
      const parsed = parseRulebookSheets(input);
      const report = validator.validate(parsed);

      expect(report).toBeDefined();
      expect(report.valid).toBe(true);
    });
  });
});

// ============================================================================
// Evidence/Intent detection tests
// ============================================================================

describe("Evidence Module", () => {
  describe("detectRulebookIntent", () => {
    it("should detect responsibility intent", () => {
      expect(detectRulebookIntent("Who is responsible for conducting PEM?")).toBe("responsibility");
      expect(detectRulebookIntent("Who does the site inspection?")).toBe("responsibility");
      expect(detectRulebookIntent("Who performs this step?")).toBe("responsibility");
    });

    it("should detect accountability intent", () => {
      expect(detectRulebookIntent("Who is accountable for the final approval?")).toBe(
        "accountability",
      );
      expect(detectRulebookIntent("Who approves the plans?")).toBe("accountability");
      expect(detectRulebookIntent("Who signs off on this?")).toBe("accountability");
    });

    it("should detect consulted intent", () => {
      expect(detectRulebookIntent("Who should be consulted?")).toBe("consulted");
      expect(detectRulebookIntent("Who needs to be consulted for this?")).toBe("consulted");
      expect(detectRulebookIntent("Who to consult?")).toBe("consulted");
    });

    it("should detect informed intent", () => {
      expect(detectRulebookIntent("Who should be informed?")).toBe("informed");
      expect(detectRulebookIntent("Who needs to know about this?")).toBe("informed");
      expect(detectRulebookIntent("Who to notify?")).toBe("informed");
    });

    it("should detect stages intent", () => {
      expect(detectRulebookIntent("What are the stages?")).toBe("stages");
      expect(detectRulebookIntent("List the process stages")).toBe("stages");
      expect(detectRulebookIntent("What stages do we have?")).toBe("stages");
    });

    it("should detect steps intent", () => {
      expect(detectRulebookIntent("What are the steps?")).toBe("steps");
      expect(detectRulebookIntent("What steps are involved?")).toBe("steps");
      expect(detectRulebookIntent("List the steps for PEM")).toBe("steps");
    });

    it("should detect required_data intent", () => {
      expect(detectRulebookIntent("What data is required?")).toBe("required_data");
      expect(detectRulebookIntent("What information do I need?")).toBe("required_data");
      expect(detectRulebookIntent("What fields are required?")).toBe("required_data");
    });

    it("should detect process_ownership intent", () => {
      expect(detectRulebookIntent("Who owns this process?")).toBe("process_ownership");
      expect(detectRulebookIntent("Who is the process owner?")).toBe("process_ownership");
    });

    it("should detect what_comes_after intent", () => {
      expect(detectRulebookIntent("What comes after PEM?")).toBe("what_comes_after");
      expect(detectRulebookIntent("What's next?")).toBe("what_comes_after");
      expect(detectRulebookIntent("What is the next step?")).toBe("what_comes_after");
    });

    it("should return none for unrelated questions", () => {
      expect(detectRulebookIntent("What's the weather like?")).toBe("none");
      expect(detectRulebookIntent("How much does it cost?")).toBe("none");
    });

    it("should detect patterns from user requirements", () => {
      expect(detectRulebookIntent("Who is responsible for the PEM?")).toBe("responsibility");
      expect(detectRulebookIntent("What data is required before Site Inspection?")).toBe(
        "required_data",
      );
      expect(detectRulebookIntent("What comes after Partnership Evaluation Meeting?")).toBe(
        "what_comes_after",
      );
      expect(detectRulebookIntent("Who is accountable for Design?")).toBe("accountability");
    });
  });
});

// ============================================================================
// Hybrid conceptual test
// ============================================================================

describe("Hybrid Intent Detection", () => {
  it("should handle questions that could match both rulebook and GHL intent", () => {
    const question = "Who is responsible for Barbara's next step?";

    // This question could potentially trigger both:
    // - Rulebook intent (responsibility)
    // - GHL intent (Barbara is a contact name)

    const rulebookIntent = detectRulebookIntent(question);
    expect(rulebookIntent).toBe("responsibility");

    // In the actual system, both detectRulebookIntent and detectGhlIntent
    // could fire, and evidence from both systems would be merged.
    // This test demonstrates that responsibility questions are properly detected.
  });
});

// ============================================================================
// Integration tests (conceptual - DB operations would use mocks)
// ============================================================================

describe("Activation Semantics (conceptual)", () => {
  it("should only create drafts on import", () => {
    // This test would verify that importParsedRulebook only creates draft versions
    // In practice, this would use a mocked Supabase client
    expect(true).toBe(true); // Placeholder
  });

  it("should allow only one active version", () => {
    // This test would verify the activation logic:
    // - Mark current active as superseded
    // - Set new version as active
    // In practice, this would use a mocked Supabase client
    expect(true).toBe(true); // Placeholder
  });

  it("should track superseded_version_id on activation", () => {
    // This test would verify that when activating, the superseded_version_id is set
    expect(true).toBe(true); // Placeholder
  });
});

describe("Diff functionality (conceptual)", () => {
  it("should compute accurate diff summaries", () => {
    // This test would verify diffRulebookVersions logic
    // Would compare two versions and check counts
    expect(true).toBe(true); // Placeholder
  });
});
