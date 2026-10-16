# Partnership Evaluation Meeting NEAT — Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is [Semantic Versioning](https://semver.org/) against the module's standard version.

For this module, the version numbers mean:

- **Major** — a change to the structured result contract, the twelve categories, or the scoring scale. Existing stored results may no longer render the same way.
- **Minor** — new capability or a new field that existing results tolerate.
- **Patch** — a fix with no contract change.

> **Reconstructed history.** Entries before this document existed were reconstructed from version control and the implementation. Dates are commit dates. Earlier entries are necessarily less detailed than future ones will be. From here on, this file is updated in the same commit as the change it describes.

---

## [Unreleased]

### To do

Nothing scheduled. Ten open gaps are listed in the [Specification](./02-specification.md#gaps-to-resolve); the four launch-blocking ones should be addressed before the module is relied on for anything consequential.

---

## [1.0.0] — 2026-07-28

The module as it exists today. Shipped across an initial sequence of eight changes on 28 July 2026, then refined.

### Added

- Two tables, `pem_neats` and `pem_neat_generations`, with row-level security: authenticated read, service-role write only (migration `025_pem_neats.sql`)
- Six-stage generation pipeline — fact ledger, sales intelligence, assessment, email, handoff, quality review — with per-stage prompts, token budgets, reasoning effort, and strict schema validation
- Twelve-category advisor assessment with scores, statuses, evidence, what worked, and coaching, plus a PALO breakdown, top strengths, top improvements, and `oneThing`
- Customer follow-up email generation with internal language forbidden and validated against in code
- BuilderTrend handoff scaffold and internal opportunity notes, with code-owned field keys
- Stage 0 transcript validation: a 200-character minimum, plus non-blocking notes for missing speaker labels, missing timestamps, encoding corruption, and content that does not resemble a PEM
- Paragraph-aware chunking with overlap for transcripts over 180,000 characters, covering beginning, middle, and end; never head and tail only
- Incomplete-ending heuristic so a truncated recording does not penalise the advisor on closing categories
- Library, create, result, and edit pages
- `/pem` Slack command returning a web handoff link, with signature verification and team allow-list
- PEM NEAT PDF export
- Mock mode for non-production environments

### Security

- All client writes denied at the database level; every write goes through the service role after an authenticated-user check
- Transcript wrapped in `<pem_transcript>` with an explicit instruction that its contents are evidence, not instructions
- Generation trace designed to carry no transcript text and no raw model output, so it is safe to display; stage outputs holding customer data kept server-only

---

## [1.0.0] — 2026-07-28 — reliability

Migration `028_pem_neat_generation_reliability.sql`.

### Added

- Durable background job generation with `after()` dispatch; the transcript is saved before generation starts so a failure never loses work
- Per-stage progress persistence driving live progress in the library
- Generation trace with per-stage duration, validation status, and error code
- Stage output persistence enabling resume from the last completed stage
- Fact ledger recovery pass when extraction returns a near-empty ledger
- Structure-only correction prompts for stages B and C when schema validation fails
- Status endpoint for lightweight polling, with extended diagnostics for administrators only
- `pem_neat_generate` added to the durable job queue's allowed types

### Changed

- Generation moved from request-response to background, so a fifteen-minute run no longer depends on the browser staying open

---

## [1.0.0] — 2026-07-28 — edit, delete, staleness

Migration `027_pem_neat_edit_delete.sql`.

### Added

- Soft delete with `deleted_at` and `deleted_by`
- `needs_regeneration` status and the `analysis_stale` flag, set when a transcript is edited after a generation, so a stale result is visibly stale rather than silently wrong
- `current_generation_transcript_hash` to tie a result to the transcript that produced it
- Error codes, finish reason, validation issue count, and diagnostics on generation history rows
- Concurrency lock preventing a second generation while one is in flight

---

## [1.0.0] — 2026-07-31 — BuilderTrend fields

### Changed

- BuilderTrend handoff scaffold expanded and field enums fixed in code
- `budgetContext` added, so a bare figure is distinguished from a figure with discussion around it

---

## [1.0.0] — 2026-08-04 — grading standard moved to governance

Migration `043_governance_pem_neat_grading_surface.sql`.

### Changed

- The grading standard split into thirteen named sections and moved to the governance surface, editable by an administrator in the web app. Section set and order stay fixed in code; only text is editable. Compiled defaults are byte-identical to the previous system prompt and remain the fallback.
- Each generation now reads the active grading content fresh, never from a cache, and records which governance version it used and whether it fell back to compiled defaults

### Why

The grading standard is a sales artifact. Requiring an engineer and a deploy to change the definition of Type 1 Pain put an engineer in the path of a sales decision. See [ADR-003](./05-adrs.md#adr-003).

---

## [1.0.0] — 2026-08-10 — multiple prospects

Migration `042_pem_neat_prospect_names.sql`.

### Added

- `prospect_names`, a structured array of individual names, as the authoritative set for matching, GIN-indexed. `prospect_name` remains the human-facing display label.
- Backfill splitting existing display names on `&`, `+`, `,` and the standalone word `and`
- Prompt handling for multiple prospects, so a meeting with two homeowners is described as such

### Fixed

- Meetings with two homeowners previously matched poorly in Baxter chat, because the combined display string was the only thing available to match against

---

## [1.0.0] — 2026-08-10 — answer quality

### Fixed

- Several improvements to how PEM records reach Baxter's conversational answers: content search, relevance calibration, coaching reachability, concept-versus-record intent routing, and cross-record aggregation. Captured in named regression tests.

---

## Earlier

PEM NEAT first appears in version control on 28 July 2026 as a sequence of eight changes. `pem_neats` is referenced in `001_initial_schema.sql`, which suggests the concept predates the implementation.

Nothing before 28 July 2026 is documented. If you need that history, version control is the only source.
