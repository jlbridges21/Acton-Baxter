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

## Web Editor

The Process Rulebook includes a visual web editor for managing drafts without requiring Google Sheets or JSON import.

### Creating a Draft

From the Overview tab:

1. Click **Edit Rulebook** to create a draft from the current active version
2. Or click **Import New** → **Create Draft** to start from scratch

### Editor Interface

The editor provides a three-column layout:

#### Left Column: Stages

- View all stages in order
- **Add Stage**: Create new stage with name and optional description
- **Move Up/Down**: Reorder stages
- **Edit**: Rename or update stage details
- **Delete**: Remove stage and all its steps (with confirmation)
- Click a stage to view its steps

#### Middle Column: Steps

- View steps within the selected stage
- **Add Step**: Create new step in current stage
- **Move Up/Down**: Reorder steps within stage
- **Edit**: Rename or update step details
- **Delete**: Remove step (with confirmation)
- Click a step to edit its details

#### Right Column: Step Details

When a step is selected, configure:

**RACI Assignments:**

- **Responsible**: Single-select dropdown (required)
- **Accountable**: Single-select dropdown (optional)
- **Consulted**: Multi-select with "Add..." dropdown
- **Informed**: Multi-select with "Add..." dropdown

**Required Data:**

- **Add** requirement with display name
- **Source System**: Select from:
  - GoHighLevel (GHL)
  - Buildertrend (shows "Not Connected" warning)
  - Knowledge
  - Manual
- **GHL Field Picker**: When GHL is selected, searchable dropdown of custom fields
- **Delete**: Remove requirement

### Validation

Click **Validate** to check:

- Required fields presence
- Unique keys
- RACI completeness (every step needs Responsible)
- GHL field path validity
- Data requirement constraints

Validation shows:

- **Errors** (red): Block activation, must be fixed
- **Warnings** (yellow): Allow activation but recommend review

### Activation

Once validation passes:

1. Click **Activate** button
2. Confirm activation in modal
3. Draft becomes the new active version
4. Previous active version is superseded

### Version History

View all versions under the **Version History** tab:

- See version number, status, created/activated dates
- View validation status
- **Edit** button for draft versions
- **Duplicate** to create a new draft from any version

### GHL Mappings

Map GoHighLevel pipeline stages to rulebook steps:

1. Navigate to **Mappings** tab
2. Select GHL pipeline and stage
3. Choose corresponding rulebook stage and step
4. Toggle enabled/disabled
5. Used for monitoring to determine which rulebook step an opportunity is in

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

### Version Management

- `list_versions`: List all rulebook versions
- `get_version`: Get full tree for a version
- `get_diff`: Compare draft vs active
- `import_sheets`: Import from structured JSON
- `import_from_google_sheet`: Import from Google Sheet ID
- `activate`: Activate a draft version

### Draft Editing

- `create_draft_from_active`: Create draft from current active
- `create_draft_from_version`: Create draft from specific version
- `create_empty_draft`: Create new empty draft
- `validate_draft`: Run validation on draft

### Stage CRUD

- `add_stage`: Add new stage to draft
- `update_stage`: Update stage properties
- `delete_stage`: Remove stage and all steps
- `reorder_stages`: Reorder stages by ID array

### Step CRUD

- `add_step`: Add step to stage
- `update_step`: Update step properties
- `delete_step`: Remove step
- `reorder_steps`: Reorder steps within stage
- `move_step`: Move step to different stage

### RACI

- `set_step_raci`: Set all RACI assignments for step

### Data Requirements

- `add_data_requirement`: Add required field to step
- `update_data_requirement`: Update requirement properties
- `delete_data_requirement`: Remove requirement

### Roles

- `create_role`: Create new process role
- `update_role`: Update role properties
- `retire_role`: Retire a role
- `list_role_assignments`: List role assignments
- `upsert_role_assignment`: Assign role to profile
- `list_profiles`: List available profiles

### Mappings

- `list_mappings`: List GHL pipeline mappings
- `upsert_mapping`: Create/update mapping
- `delete_mapping`: Remove mapping
- `list_ghl_custom_fields`: List GHL fields
- `list_ghl_pipelines`: List GHL pipelines

### Export

- `export_version`: Export version as sheets structure
