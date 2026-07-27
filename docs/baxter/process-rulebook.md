# Process Rulebook

The Process Rulebook is a versioned system for defining RACI (Responsible, Accountable, Consulted, Informed) matrices and required data for the Acton ADU pre-PEM property acquisition process.

## Purpose

The Process Rulebook serves several key functions:

1. **Responsibility Mapping**: Defines who is Responsible, Accountable, Consulted, and Informed for each process step
2. **Data Requirements**: Specifies which data fields are required at each step and their source systems
3. **Process Documentation**: Provides a structured view of stages and steps in the acquisition process
4. **Q&A Integration**: Powers Baxter AI's ability to answer questions about responsibilities and required data

## Schema

The rulebook consists of five main entities:

### 1. Roles

Define the process roles (e.g., Project Manager, Owner, Site Inspector).

**Fields:**

- `role_key`: Unique identifier (e.g., `project_manager`)
- `display_name`: Human-readable name (e.g., "Project Manager")
- `description`: Optional description

### 2. Stages

High-level phases of the process (e.g., Initial Assessment, Partnership Evaluation).

**Fields:**

- `stage_key`: Unique identifier
- `display_name`: Human-readable name
- `external_stage_name`: Buildertrend stage mapping (optional)
- `order_index`: Numeric position (0-based)
- `duration_days_budget`: Expected duration in days (optional)
- `description`: Optional description

### 3. Steps

Individual actions within each stage (e.g., Site Inspection, Design Review).

**Fields:**

- `step_key`: Unique identifier
- `stage_key`: Parent stage reference
- `display_name`: Human-readable name
- `order_index`: Numeric position within stage (0-based)
- `duration_days_budget`: Expected duration in days (optional)
- `description`: Optional description

### 4. RACI

Responsibility assignments for each step.

**Fields:**

- `step_key`: Reference to step
- `role_key`: Reference to role
- `raci`: One of: `R` (Responsible), `A` (Accountable), `C` (Consulted), `I` (Informed)

**Rules:**

- Each step MUST have exactly one `R` (Responsible)
- Each step SHOULD have at most one `A` (Accountable)
- Each step can have multiple `C` (Consulted) and `I` (Informed)

### 5. Data Requirements

Fields required at each step.

**Fields:**

- `step_key`: Reference to step
- `field_key`: Unique field identifier
- `display_name`: Human-readable field name
- `source_system`: One of: `ghl`, `buildertrend`, `knowledge`, `manual`
- `source_field_path`: Path to field in source system (required for `ghl`)
- `required`: Boolean (default: true)
- `description`: Optional description

## Google Sheet Template

The rulebook can be imported from a Google Sheet with the following tabs:

### Roles Tab

| role_key | display_name    | description                  |
| -------- | --------------- | ---------------------------- |
| pm       | Project Manager | Manages day-to-day execution |

### Stages Tab

| stage_key          | display_name       | external_stage_name | order_index | duration_days_budget | description      |
| ------------------ | ------------------ | ------------------- | ----------- | -------------------- | ---------------- |
| initial_assessment | Initial Assessment | Initial Assessment  | 0           | 7                    | First evaluation |

### Steps Tab

| step_key        | stage_key          | display_name    | order_index | duration_days_budget | description         |
| --------------- | ------------------ | --------------- | ----------- | -------------------- | ------------------- |
| site_inspection | initial_assessment | Site Inspection | 0           | 1                    | Physical site visit |

### RACI Tab

| step_key        | role_key | raci |
| --------------- | -------- | ---- |
| site_inspection | pm       | R    |
| site_inspection | owner    | A    |

### DataRequirements Tab

| step_key        | field_key        | display_name     | source_system | source_field_path | required | description         |
| --------------- | ---------------- | ---------------- | ------------- | ----------------- | -------- | ------------------- |
| site_inspection | property_address | Property Address | ghl           | contact.address1  | TRUE     | Full street address |

## Import Process

1. **Navigate to Admin > Rulebook > Import**
2. Choose import method:
   - **Google Sheet**: Enter the Sheet ID from the URL
   - **JSON**: Paste structured JSON data
3. **Validate**: System validates the import and shows errors/warnings
4. **Review Diff**: If there's an active version, compare changes
5. **Activate**: If validation passes, activate the new version

## Validation

The system performs comprehensive validation:

### Errors (block activation):

- Duplicate stage or step keys
- Duplicate order indices
- Unknown references (stage, step, role)
- Missing Responsible (R) role per step
- Multiple Responsible or Accountable per step
- Invalid RACI values
- Invalid source systems
- GHL fields missing source_field_path

### Warnings (allow activation):

- Missing durations
- Missing Accountable role
- Unused roles
- Missing Buildertrend mappings

## Versioning

- Each import creates a new **DRAFT** version
- Only one version can be **ACTIVE** at a time
- Activating a new version marks the previous as **SUPERSEDED**
- All versions are retained for history

## Activation

To activate a draft version:

1. Version must pass validation (no errors)
2. Warnings are allowed but should be reviewed
3. Activation is atomic and immediate
4. Previous active version is automatically superseded

## Role Assignments

Roles defined in the rulebook can be assigned to specific team members:

1. **Navigate to Admin > Rulebook > Role Assignments**
2. Select a role and choose an assignee from the dropdown
3. Assignments are effective immediately
4. Used for notifications, dashboards, and responsibility tracking

## Q&A Integration

When the rulebook is active, Baxter AI can answer questions like:

- "Who is responsible for the PEM?"
- "What data is required before Site Inspection?"
- "What comes after Partnership Evaluation Meeting?"
- "Who is accountable for Design?"

The system automatically:

- Detects rulebook-related intent
- Retrieves relevant evidence
- Merges with other knowledge sources
- Provides structured answers with proper citations

## Future Enhancements

Potential future capabilities (not yet implemented):

### Monitoring

- Track actual vs. budgeted durations
- Identify process bottlenecks
- Alert on missed responsibilities
- Dashboard for process health

### Automation

- Auto-assignment based on roles
- Workflow triggers
- Required data validation gates
- Notification routing

### Integration

- Buildertrend stage sync
- GHL field mapping validation
- Slack mentions for responsibilities
- Calendar integration for durations

## Admin Access

Only users with the `admin` role can:

- Import new versions
- Activate versions
- Assign roles
- View full rulebook details

## API Reference

All rulebook operations are handled through:

- **API**: `/api/admin/baxter/rulebook`
- **UI**: `/admin/baxter/rulebook`

Supported actions:

- `list_versions`
- `get_version`
- `get_diff`
- `import_sheets`
- `import_from_google_sheet`
- `activate`
- `list_role_assignments`
- `upsert_role_assignment`
- `list_profiles`
