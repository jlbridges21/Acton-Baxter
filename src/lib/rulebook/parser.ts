/**
 * Parser for Process Rulebook sheets.
 * Header-name based parsing (not column position).
 * Accepts Record arrays or CSV-like grids.
 */

import type {
  SheetInput,
  SheetRow,
  SheetGrid,
  ParsedRulebook,
  ParsedRole,
  ParsedStage,
  ParsedStep,
  ParsedRaci,
  ParsedDataRequirement,
  RaciValue,
  SourceSystem,
} from "./types";

// ============================================================================
// Grid to Records conversion
// ============================================================================

function gridToRecords(grid: SheetGrid): SheetRow[] {
  if (grid.length === 0) return [];

  const headerRow = grid[0];
  if (!headerRow) return [];
  const dataRows = grid.slice(1);
  const headers = headerRow.map((h) => h.trim().toLowerCase());

  return dataRows.map((row) => {
    const record: SheetRow = {};
    headers.forEach((header, idx) => {
      if (header && row[idx] !== undefined) {
        record[header] = String(row[idx]).trim();
      }
    });
    return record;
  });
}

// ============================================================================
// Normalize header names (handle variations)
// ============================================================================

const HEADER_ALIASES: Record<string, string> = {
  "role key": "role_key",
  role_key: "role_key",
  rolekey: "role_key",

  "display name": "display_name",
  display_name: "display_name",
  displayname: "display_name",
  name: "display_name",

  description: "description",
  desc: "description",

  "stage key": "stage_key",
  stage_key: "stage_key",
  stagekey: "stage_key",

  "external stage name": "external_stage_name",
  external_stage_name: "external_stage_name",
  "buildertrend stage": "external_stage_name",

  order: "order_index",
  "order index": "order_index",
  order_index: "order_index",
  orderindex: "order_index",
  index: "order_index",

  duration: "duration_days_budget",
  "duration days": "duration_days_budget",
  duration_days: "duration_days_budget",
  duration_days_budget: "duration_days_budget",
  days: "duration_days_budget",

  "step key": "step_key",
  step_key: "step_key",
  stepkey: "step_key",

  raci: "raci",

  "field key": "field_key",
  field_key: "field_key",
  fieldkey: "field_key",

  "source system": "source_system",
  source_system: "source_system",
  system: "source_system",
  source: "source_system",

  "source field path": "source_field_path",
  source_field_path: "source_field_path",
  "field path": "source_field_path",
  field_path: "source_field_path",
  path: "source_field_path",

  required: "required",
};

function normalizeHeaders(record: SheetRow): SheetRow {
  const normalized: SheetRow = {};

  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase().trim();
    const mappedKey = HEADER_ALIASES[lowerKey] || lowerKey;
    normalized[mappedKey] = value;
  }

  return normalized;
}

// ============================================================================
// Parse individual sheet types
// ============================================================================

function parseRolesSheet(rows: SheetRow[]): ParsedRole[] {
  const roles: ParsedRole[] = [];

  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);

    const role_key = row.role_key;
    const display_name = row.display_name;

    if (!role_key || !display_name) {
      continue; // Skip incomplete rows
    }

    roles.push({
      role_key,
      display_name,
      description: row.description || undefined,
    });
  }

  return roles;
}

function parseStagesSheet(rows: SheetRow[]): ParsedStage[] {
  const stages: ParsedStage[] = [];

  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);

    const stage_key = row.stage_key;
    const display_name = row.display_name;
    const order_str = row.order_index || row.order;

    if (!stage_key || !display_name || !order_str) {
      continue;
    }

    const order_index = parseInt(order_str, 10);
    if (isNaN(order_index)) {
      continue;
    }

    const stage: ParsedStage = {
      stage_key,
      display_name,
      order_index,
    };

    if (row.external_stage_name) {
      stage.external_stage_name = row.external_stage_name;
    }

    if (row.duration_days_budget) {
      const duration = parseFloat(row.duration_days_budget);
      if (!isNaN(duration)) {
        stage.duration_days_budget = duration;
      }
    }

    if (row.description) {
      stage.description = row.description;
    }

    stages.push(stage);
  }

  return stages;
}

function parseStepsSheet(rows: SheetRow[]): ParsedStep[] {
  const steps: ParsedStep[] = [];

  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);

    const step_key = row.step_key;
    const stage_key = row.stage_key;
    const display_name = row.display_name;
    const order_str = row.order_index || row.order;

    if (!step_key || !stage_key || !display_name || !order_str) {
      continue;
    }

    const order_index = parseInt(order_str, 10);
    if (isNaN(order_index)) {
      continue;
    }

    const step: ParsedStep = {
      step_key,
      stage_key,
      display_name,
      order_index,
    };

    if (row.duration_days_budget) {
      const duration = parseFloat(row.duration_days_budget);
      if (!isNaN(duration)) {
        step.duration_days_budget = duration;
      }
    }

    if (row.description) {
      step.description = row.description;
    }

    steps.push(step);
  }

  return steps;
}

function parseRaciSheet(rows: SheetRow[]): ParsedRaci[] {
  const raci: ParsedRaci[] = [];

  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);

    const step_key = row.step_key;
    const role_key = row.role_key;
    const raci_value = row.raci?.toUpperCase();

    if (!step_key || !role_key || !raci_value) {
      continue;
    }

    if (!["R", "A", "C", "I"].includes(raci_value)) {
      continue;
    }

    raci.push({
      step_key,
      role_key,
      raci: raci_value as RaciValue,
    });
  }

  return raci;
}

function parseDataRequirementsSheet(rows: SheetRow[]): ParsedDataRequirement[] {
  const requirements: ParsedDataRequirement[] = [];

  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);

    const step_key = row.step_key;
    const field_key = row.field_key;
    const display_name = row.display_name;
    const source_system = row.source_system?.toLowerCase();

    if (!step_key || !field_key || !display_name || !source_system) {
      continue;
    }

    if (!["ghl", "buildertrend", "knowledge", "manual"].includes(source_system)) {
      continue;
    }

    const requirement: ParsedDataRequirement = {
      step_key,
      field_key,
      display_name,
      source_system: source_system as SourceSystem,
    };

    if (row.source_field_path) {
      requirement.source_field_path = row.source_field_path;
    }

    if (row.required !== undefined) {
      const req = row.required.toLowerCase();
      requirement.required = req === "true" || req === "yes" || req === "1";
    }

    if (row.description) {
      requirement.description = row.description;
    }

    requirements.push(requirement);
  }

  return requirements;
}

// ============================================================================
// Main parser
// ============================================================================

export function parseRulebookSheets(input: SheetInput): ParsedRulebook {
  let sheets: Record<string, SheetRow[]>;

  if ("sheets" in input) {
    sheets = input.sheets;
  } else {
    // Convert grids to records
    sheets = {};
    for (const [name, grid] of Object.entries(input.grids)) {
      sheets[name] = gridToRecords(grid);
    }
  }

  // Normalize sheet names (case-insensitive lookup)
  const sheetLookup: Record<string, SheetRow[]> = {};
  for (const [name, rows] of Object.entries(sheets)) {
    sheetLookup[name.toLowerCase().trim()] = rows;
  }

  const roles = parseRolesSheet(sheetLookup["roles"] || []);
  const stages = parseStagesSheet(sheetLookup["stages"] || []);
  const steps = parseStepsSheet(sheetLookup["steps"] || []);
  const raci = parseRaciSheet(sheetLookup["raci"] || []);
  const data_requirements = parseDataRequirementsSheet(
    sheetLookup["datarequirements"] || sheetLookup["data_requirements"] || [],
  );

  return {
    roles,
    stages,
    steps,
    raci,
    data_requirements,
  };
}
