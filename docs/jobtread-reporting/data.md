# Data: model, fields, and sync

## 4. Data model and mappings

Cache tables (migration 068):

| Table                | Contents                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jt_connection`      | Singleton: connection status, org name, grant name/expiry/unrestricted flag, sync interval. No key.                                                                                                                                  |
| `jt_sync_runs`       | One row per sync: status, API requests, records seen/removed, duration, error.                                                                                                                                                       |
| `jt_custom_fields`   | Every discovered custom field by **stable id**: name, type, target, options, plus admin-owned `display_name`, `description`, `category`.                                                                                             |
| `jt_semantic_fields` | Business vocabulary: `key` (e.g. `phase`) → `custom_field_id`. Admin edits stick.                                                                                                                                                    |
| `jt_jobs`            | One row per job: number, name, dates, location/address, customer name, projected price/cost, schedule summary, and `job_fields` / `location_fields` / `customer_fields` (custom-field id → values[]). `removed_at` for soft removal. |
| `jt_catalog_models`  | Top-level catalog cost groups with item count and server-side cost/price sums.                                                                                                                                                       |

Field references in reports:

| Form        | Example                | Meaning                                               |
| ----------- | ---------------------- | ----------------------------------------------------- |
| `job.*`     | `job.name`, `job.city` | Built-in job attributes (`src/lib/reports/fields.ts`) |
| `cf:<id>`   | `cf:22PgDDbmPixs`      | A job, location, or customer custom field by id       |
| `sem:<key>` | `sem:phase`            | Business term, resolved through `jt_semantic_fields`  |
| `model.*`   | `model.basePrice`      | Product Library model attributes                      |

Derived values (documented in each field's provenance): projected margin = price − cost;
margin % = (price − cost) ÷ price × 100; model series/code are parsed from the model name;
"Budget status" = imported when the model has catalog line items, otherwise "Pending import"
(and its cost/price are left blank — never zero-filled).

**Active projects** are defined by the **Phase** field (any of BR-/Custom- Estimating, Design,
Permitting, Production). The JobTread **Status** field is almost always blank, so it is not
used to decide what's active.

## 5. Supported JobTread entities and fields

Discovered on 2026-10-22 (live, read-only) and re-verified through the integration code:

- **Jobs:** 447 (all cached). Phase is filled on 445: Canceled 289, Complete 95, Warranty 28,
  active 33 (9 in design, 9 in permitting).
- **Custom fields:** 121 on job, location, and customer targets (vendor/contact/cost-item
  fields are not synced). Notable: Phase, Project Manager (Maxx, Connor, Rebecca…), Model,
  Total Sqft, Permit Status, Design Coordinator, Drafter, site & utility fields on the
  location (foundation, electrical, panel, sewer, water line/meter, zoning, climate zone, WUI,
  soils, sprinklers, trench length, APN), and customer fields such as "Recommended BR Models"
  and "Customer Priorities & Must-Haves". **Option fields can hold several values** (e.g.
  Electrical); they're kept as lists and counted under each value.
- **Catalog (Product Library):** 79 top-level cost groups; 77 are ADU models (description
  mentions "Product Library"). Only 2 have budget line items imported (e.g. "i 398": 157
  items, cost $263,300.56, price $368,620.75); the rest are "pending import".
- **Per-job live detail:** schedule groups (Sales, Estimating, Design, Permitting, Production,
  Inspections, Finance, Warranty) with group start/end dates (`calculateGroup`), checklist
  groups with completed/started/unstarted counts, and file names/folders (no file URLs).
- **Not available in JobTread:** time entries (0 — so no design hours), product specs
  (bedrooms, dimensions, appliances), vault height, floorplan/approved site plan as fields
  (they're files).

Default access categories for newly discovered fields (`defaultCategory`, admins can change):
finance words (budget, price, cost, margin, payment, salary) → **financial**; customer-target
fields → **customer**, except "Recommended BR Models", "Customer Priorities & Must-Haves",
"Scope Clarifications", "Project Purpose", "Customer Goals" → **general**, and sales-strategy
notes (internal strategy, decision dynamics, concerns & fears, decision makers, sales
commitments) → **internal**; email/phone fields → **customer**; other targets → **excluded**.

## 6. Synchronization behavior

- **Full reconciliation** (`runFullSync`): test connection → sync custom-field metadata →
  sync all jobs → sync catalog models. JobTread jobs don't expose a reliable "updated at", and
  the full dataset is small, so every run re-reads everything (~22 requests, ~3 s).
- Pages use cursor pagination; when JobTread answers **413 (too large)** the page size is
  halved (down to 5) and retried. 429/5xx/timeouts retry with exponential backoff; 401/403
  fail immediately as "grant expired or revoked".
- Jobs or models missing from a successful run are **soft-removed** (`removed_at`), never
  deleted. Removed custom fields are marked removed; reports that use them explain the gap.
- Admin edits (display names, descriptions, categories, vocabulary mappings — including an
  explicit "not mapped") are never overwritten by discovery.
- Only one sync runs at a time (a run younger than 10 minutes blocks a new one).
- Triggers: **Sync now** in Data settings, scheduled via the existing cron when
  `JOBTREAD_SYNC_ENABLED=true` and the interval has elapsed, and automatically on first use
  (the first report view or Dexter request after connecting runs the initial sync).
- Freshness is shown on every report ("JobTread data synced 12 min ago · project details live
  just now").
