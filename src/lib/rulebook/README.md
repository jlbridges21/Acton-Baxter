# Process Rulebook Library

Versioned machine-readable Acton process definitions (RACI + required data).

## Overview

The Process Rulebook library manages versioned process definitions including:

- **Roles**: Process roles (not people) like "project_manager", "sales_lead"
- **Stages**: High-level process phases (e.g., "Pre-Construction", "Construction")
- **Steps**: Individual process steps within stages
- **RACI**: Responsibility assignments (Responsible, Accountable, Consulted, Informed)
- **Data Requirements**: Required data fields for each step with source systems

## Architecture

### Core Modules

- **types.ts** - All TypeScript type definitions
- **schema.ts** - Zod validation schemas for parsed data
- **parser.ts** - Parse sheet tabs (header-name based, supports Record arrays or CSV grids)
- **validator.ts** - Validation with errors and warnings
- **import.ts** - Import parsed rulebook (creates NEW DRAFT only, never touches active)
- **versions.ts** - Version management (get, list, activate, diff, load tree)
- **roles.ts** - Role and assignment management
- **api.ts** - Clean programmatic API for future monitoring contract
- **evidence.ts** - Baxter AI integration (intent detection, evidence retrieval)
- **capabilities.ts** - Capability checks (hasActiveRulebook)
- **index.ts** - Module exports

### Sheet Format

The parser accepts data in two formats:

#### 1. Record Array Format (Recommended)

```typescript
{
  sheets: {
    Roles: [
      { role_key: "pm", display_name: "Project Manager", description: "..." },
      // ...
    ],
    Stages: [
      { stage_key: "pre_construction", display_name: "Pre-Construction", order_index: "0", ... },
      // ...
    ],
    Steps: [
      { step_key: "conduct_pem", stage_key: "pre_construction", display_name: "Conduct PEM", ... },
      // ...
    ],
    RACI: [
      { step_key: "conduct_pem", role_key: "pm", raci: "R" },
      // ...
    ],
    DataRequirements: [
      { step_key: "conduct_pem", field_key: "customer_name", display_name: "Customer Name", source_system: "ghl", ... },
      // ...
    ]
  }
}
```

#### 2. Grid Format (CSV-like)

```typescript
{
  grids: {
    Roles: [
      ["role_key", "display_name", "description"],
      ["pm", "Project Manager", "Oversees projects"],
      // ...
    ],
    // ... other grids
  }
}
```

### Header Name Normalization

The parser automatically normalizes header names, so these are all equivalent:

- `role_key`, `Role Key`, `rolekey`
- `display_name`, `Display Name`, `name`
- `order_index`, `Order Index`, `Order`, `index`

### Validation Rules

#### Errors (block import)

- Duplicate stage/step keys
- Duplicate stage/step order indices
- Unknown stage/step/role references
- Missing Responsible (R) in RACI
- Multiple Responsible (R) in RACI
- Multiple Accountable (A) in RACI
- Invalid RACI values (must be R, A, C, or I)
- Invalid source_system (must be ghl, buildertrend, knowledge, manual)
- Invalid/zero/negative order indices
- Invalid/zero/negative durations
- GHL source missing source_field_path when required
- Duplicate field keys per step

#### Warnings (informational)

- Missing duration budgets
- Missing Accountable (A) in RACI
- Unused roles (defined but not referenced)
- Missing external_stage_name (Buildertrend mapping)

## Usage Examples

### Parse and Validate

```typescript
import { parseRulebookSheets, validateParsedRulebook } from "@/lib/rulebook";

const input = { sheets: { Roles: [...], Stages: [...], ... } };
const parsed = parseRulebookSheets(input);
const report = validateParsedRulebook(parsed);

if (report.valid) {
  console.log("✓ Valid rulebook");
} else {
  console.error("Errors:", report.errors);
}
```

### Import as Draft

```typescript
import { importParsedRulebook } from "@/lib/rulebook";

const result = await importParsedRulebook(parsed, report, {
  sourceDescription: "Imported from Google Sheets",
  sourceReference: "https://docs.google.com/spreadsheets/d/...",
  importedBy: userId,
});

if (result.success) {
  console.log(`Created draft version ${result.versionNumber}`);
}
```

### Activate a Draft

```typescript
import { activateRulebookVersion } from "@/lib/rulebook";

const result = await activateRulebookVersion(versionId, userId);
// Automatically supersedes current active version
```

### Query Active Rulebook

```typescript
import { getActiveRulebook, loadRulebookTree } from "@/lib/rulebook";

const active = await getActiveRulebook();
if (active) {
  const tree = await loadRulebookTree(active.id);
  // tree.stages[0].steps[0].raci
  // tree.stages[0].steps[0].data_requirements
}
```

### Monitoring API

```typescript
import { getStep, getStepRaci, getRequiredData } from "@/lib/rulebook";

const step = await getStep("conduct_pem");
const raci = await getStepRaci("conduct_pem");
const requiredData = await getRequiredData("conduct_pem");
```

### Baxter AI Integration

```typescript
import { detectRulebookIntent, retrieveRulebookEvidence } from "@/lib/rulebook";

const intent = detectRulebookIntent("Who is responsible for conducting PEM?");
// Returns: "responsibility"

const evidence = await retrieveRulebookEvidence("Who is responsible for conducting PEM?");
// Returns: BaxterContextItem[] with relevant process data
```

## Database Schema

See `supabase/migrations/022_process_rulebook.sql` for full schema.

Key tables:

- `process_roles` - Role definitions (shared across versions)
- `process_role_assignments` - People assigned to roles (time-bounded)
- `rulebook_versions` - Version metadata (draft/active/superseded)
- `process_stages` - Stages per version
- `process_steps` - Steps per version
- `process_step_raci` - RACI assignments per step
- `process_step_data_requirements` - Required data per step

## Testing

```bash
npm test -- tests/unit/rulebook.test.ts
```

Test fixtures are in `tests/fixtures/rulebook/`:

- `valid-complete.json` - Complete valid rulebook
- `invalid-missing-r.json` - Missing Responsible
- `invalid-multiple-r.json` - Multiple Responsible
- `invalid-multiple-a.json` - Multiple Accountable
- `unknown-role.json` - Unknown role reference
- `unknown-stage.json` - Unknown stage reference
- `unknown-step.json` - Unknown step reference
- `invalid-duration.json` - Invalid durations
- `missing-ghl-path.json` - GHL source missing path
- `duplicate-keys.json` - Duplicate keys

## Important Notes

1. **Import Always Creates Draft**: `importParsedRulebook` NEVER modifies active versions
2. **One Active Version**: Database enforces exactly one active version via unique index
3. **Service Role Required**: All write operations use `createServiceClient()` from `@/lib/supabase/admin`
4. **Server-Only Modules**: DB modules import "server-only"
5. **Role Assignments Independent**: Role assignments evolve independently of rulebook versions
6. **Evidence Active Only**: `retrieveRulebookEvidence` uses ACTIVE version only
7. **Future Monitoring**: The `api.ts` module provides clean contract for monitoring systems

## Future Work (Out of Scope)

- Monitoring system implementation
- Buildertrend connector
- Admin UI for version management
- Import UI for Google Sheets
- DOMO/Buildertrend integration
