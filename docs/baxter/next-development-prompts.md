# Baxter — Next Development Prompts

**Date:** July 27, 2026 · **Author:** Repo gap analysis (senior AI-agent architecture review)

This file contains the next three implementation prompts for Cursor, in recommended order. They were chosen by comparing the code as it exists today against the Baxter 2.0 end state (Project Brief, "How We Get It Working", governance v1.1).

**Why these three.** Baxter's reactive half is genuinely done: shared `answerBaxterQuestion()` pipeline, governed runtime prompt (v1.1), hybrid retrieval with citations, live GHL reads with confirmed writes, production Slack Q&A with durable dedupe, admin diagnostics/evals/launch-readiness. What does not exist in code — at all — is the proactive half that the brief calls the entire point: there is no machine-readable process rulebook, no monitoring/sweep job of any kind (the queue knows exactly four job types, none of them monitoring), no alert lifecycle, and no project-data ingestion. These prompts build that spine in dependency order. Each prompt is deterministic-first by design: the LLM phrases messages; it never decides what to flag. That is the governance answer to the "ambient mode is ungoverned" and "alert fatigue kills adoption" red flags.

**What explicitly waits (all three prompts):**

- No agentic tool-loop rewrite of the Q&A pipeline. The deterministic router + single LLM call is working and audited; do not rebuild it.
- No Domo, no Phase 2 optimizer, no Phase 3 news agent, no Phase 4 code agent.
- No autonomous writes anywhere; no customer-facing messages; no GHL message send / calendar booking.
- No real-time syncs. Daily/periodic snapshots are the architecture, per the brief.
- No embedding of CRM or project data into the Knowledge Base (keep the live-evidence pattern).

---

## Prompt 1 — Machine-Readable Process Rulebook (RACI + data mapping)

Copy everything below into Cursor as one prompt.

---

You are working in the Acton ADU Baxter repo (Next.js App Router + Supabase + Vercel). Read `AGENTS.md` first and follow it. Before writing any code, inspect and understand the existing architecture — you are extending it, not rebuilding it:

- `docs/baxter/baxter-runtime-prompt-v1-1.md`, `docs/baxter/baxter-governance-v1-1.md`, `docs/baxter/governance-architecture.md` — Baxter's governance model. The RACI matrix is the rulebook Baxter monitors against; today it exists only as prose.
- `src/lib/baxter-ai/governance/` — runtime prompt assembly (`assemble.ts`, `capabilities.ts`). Capabilities are conditional on what is actually connected; you will extend this pattern.
- `src/lib/knowledge-index/` — structured knowledge units, `spreadsheet-parser.ts`, `structured-search.ts`. Reuse parsing/validation idioms; do NOT store the rulebook as knowledge units — it is first-class operational data, like GHL data, not retrievable prose.
- `src/lib/connectors/google/` and `docs/google-drive-knowledge-manager.md` — Google Sheets already sync with structured tabs/headers/rows. The team maintains the RACI matrix in Google Sheets; that is the import source.
- `src/lib/baxter-ai/context.ts` and `answer.ts` — how evidence (KB + live GHL) is merged and wrapped with `wrapEvidenceAsData()`. Rulebook answers must flow through the same evidence path.
- `supabase/migrations/` — migrations are numbered sequentially; the next is `022`.

### Goal

Build the versioned, validated, machine-readable process rulebook (RACI matrix + per-step data requirements) that all future monitoring depends on, plus Q&A integration so Baxter can answer "who is responsible for X?" and "what data is required at step Y?" with citations, today.

The conversion of the human RACI document is people-work owned by Maxx — your job is to build the container, the validator, and the import path so that work has somewhere rigorous to land. Nothing activates without passing validation. Every activation is a new immutable version.

### Build

1. **Migration `022_process_rulebook.sql`:**
   - `process_roles` (id, role_key, display_name) and `process_role_assignments` (role_key → `profiles.id`, optional `slack_user_id`, effective dates). Roles are indirected — the matrix names roles, assignments name people.
   - `rulebook_versions` (id, version_number, status `draft|active|superseded`, source description, imported_by, validation_report_json, created_at, activated_at). Exactly one active version; prior versions retained (governance requires version control from day one).
   - `process_stages` (version_id FK, stage_key, display_name, `external_stage_name` nullable — reserved for the exact Buildertrend stage-name match required later, order_index, duration_days_budget nullable).
   - `process_steps` (version_id, stage_id FK, step_key, display_name, order_index, duration_days_budget nullable, description).
   - `process_step_raci` (step_id, role_key, raci `R|A|C|I`). Enforce exactly one R and at most one A per step via constraint or validation.
   - `process_step_data_requirements` (step_id, field_key, display_name, source_system `ghl|buildertrend|knowledge|manual`, source_field_path nullable — e.g. a GHL custom-field key, required boolean).
   - RLS consistent with existing admin-only tables.
2. **Import pipeline** in `src/lib/rulebook/` (new module, mirroring the structure of `src/lib/connectors/ghl/`): parse a designated Google-synced spreadsheet (reuse the structured Sheets rows already stored by the Google connector; support direct CSV/XLSX upload as a fallback using the existing `knowledge_uploads` parsing utilities). Define the sheet template in code and document it (tabs: Stages, Steps, RACI, DataRequirements, Roles).
3. **Strict validation → report, not exceptions:** unknown stage/step references, duplicate keys, missing R, multiple A, durations that aren't positive numbers, unmapped roles, data requirements pointing at `ghl` without a `source_field_path`. Import always produces a draft version + a stored validation report; activation is a separate admin action that is refused while errors exist (warnings allowed, listed).
4. **Admin UI `/admin/baxter/rulebook`:** current active version + status; import from the configured Sheet or upload; validation report; diff summary vs. previous version (stages/steps added/removed/changed); role-assignment editor mapping role_keys to profiles/Slack users. Follow existing admin page conventions (`/admin/baxter/governance`, `/admin/connectors/ghl`).
5. **Q&A integration:** a `retrieveRulebookEvidence(question)` provider that detects responsibility/process-step/data-requirement questions (deterministic patterns, same idiom as `ghl-intent.ts`) and returns evidence items citing "RACI matrix vN (active)". Merge in `answer.ts` exactly the way GHL live evidence is merged (numbered items, `wrapEvidenceAsData`). Update `governance/capabilities.ts` to conditionally claim "Answer responsibility and required-data questions from the versioned RACI rulebook" only when an active version exists.
6. **Do not** build any monitoring, alerting, or scheduled checks in this prompt. Rulebook + Q&A only.

### Test

- Unit tests (Vitest, pattern: `tests/unit/ghl-crm-ux.test.ts`): parser happy path + every validation failure class; version activation semantics (one active, supersede); RACI constraint enforcement; evidence provider question-detection and citation output; capabilities block with/without an active version.
- Add fixture sheets under `tests/fixtures/`.
- Run `npm run format && npm run lint && npm run typecheck && npm run test` and fix everything you broke.

### Report manual setup steps

Finish your reply with a checklist: run migration 022 in Supabase; create the RACI Google Sheet from the documented template and include it in the Google connector's synced selection (or use upload); Maxx populates it; admin imports, fixes validation errors, activates; admin maps role assignments. Update `docs/baxter-roadmap.md` and add a new `docs/baxter/process-rulebook.md` guide.

---

## Prompt 2 — Proactive Monitoring Engine + Alert Lifecycle (GHL scope)

Copy everything below into Cursor as one prompt. Requires Prompt 1 to be merged.

---

You are working in the Acton ADU Baxter repo. Read `AGENTS.md` first. Inspect before building — this prompt turns Baxter from reactive to proactive using infrastructure that already exists:

- `src/lib/jobs/` (`types.ts`, `queue.ts`, `process.ts`) — Supabase-backed job queue with a typed `JOB_TYPES` union and a dispatch switch in `processJob()`. Add job types here; do not build a second queue.
- `src/app/api/internal/process-jobs/route.ts` + `src/lib/jobs/cron-auth.ts` + `vercel.json` — the cron entry point (Bearer `CRON_SECRET`). Today it runs once daily (Hobby-safe).
- `src/lib/connectors/ghl/insights.ts` — `getStaleOpportunities`, `getUnownedOpportunities`, `getAppointmentsInRange` already exist as read-only primitives. Reuse them as check inputs.
- `src/lib/connectors/ghl/health.ts`, `capabilities.ts` — connector health probes; `src/lib/connectors/google/` sync-run freshness.
- `src/lib/slack/client.ts` (`postSlackMessage`, reactions), `format.ts`, `config.ts`, `src/app/api/slack/events/route.ts` and `baxter-events.ts` — note `shouldIgnoreSlackEvent()` deliberately drops `reaction_*` events from the Q&A pipeline; acknowledgments need a separate handler, not a change to that guard.
- `src/lib/rulebook/` (from Prompt 1) — data requirements and role assignments drive checks and routing.
- `docs/baxter/baxter-governance-v1-1.md` — the alert-fatigue, quiet-hours, acknowledgment, and escalation PLACEHOLDERs/red flags. This prompt implements the mechanics with configurable defaults so those team decisions become settings, not code changes.

### Goal

A deterministic monitoring engine that sweeps live GoHighLevel data (already connected) plus feed health on a schedule, persists findings with a full lifecycle, and posts governed alerts to one pilot Slack channel — with acknowledgment, escalation, digest batching, quiet hours, and a tracked false-positive rate. Do not wait for Buildertrend to build the proactive spine: tuning alert quality on CRM data now is what de-risks Phase 1b.

Architecture rule (non-negotiable): checks are pure deterministic functions over synced/live data + the rulebook. The LLM's only monitoring role is phrasing an already-decided finding into Baxter's voice (via the existing governance system prompt), with a deterministic template fallback if the LLM call fails. The model never decides whether something is alert-worthy.

### Build

1. **Migration `023_baxter_monitoring.sql`:**
   - `baxter_findings` (id, check_key, dedupe_key unique per open finding, severity, entity refs — ghl contact/opportunity ids, rulebook step_key —, evidence_json, recommendation, status `open|alerted|acknowledged|resolved|dismissed_false_positive|expired`, responsible_role_key, slack_channel_id, slack_message_ts, acknowledged_by, timestamps).
   - `baxter_monitoring_runs` (id, started/finished, checks_run, findings_new/resolved, status, error).
   - `baxter_alert_settings` (singleton row: pilot channel id, quiet-hours window + timezone, digest_mode boolean, escalation_window_minutes, enabled boolean, per-check enable/threshold overrides json).
2. **Check registry** `src/lib/monitoring/checks/` — each check exports `{ key, describe, run(ctx): Finding[] }`:
   - `ghl_stale_opportunity` (reuse `getStaleOpportunities`; threshold from settings).
   - `ghl_unowned_opportunity` (reuse `getUnownedOpportunities`).
   - `ghl_missing_required_fields` — for rulebook data requirements with `source_system='ghl'` and a `source_field_path`, verify presence on the relevant records; finding names the field, record, and responsible role per the rulebook.
   - `feed_health` — GHL capability probe failing, or Google sync last-success older than its configured interval ×2. Per the vision doc: if a feed breaks, Baxter announces it; he never pretends to see what he can't.
3. **Sweep job:** new `JOB_TYPES` entries `baxter_monitor_sweep` and `baxter_alert_delivery`. Sweep runs all enabled checks, upserts findings by dedupe_key (re-detected → refresh evidence; no longer detected → auto-resolve), records a monitoring run, then enqueues delivery. `process-jobs` route enqueues a due sweep the same way `maybeEnqueueScheduledGoogleSync()` works (interval env `BAXTER_MONITOR_INTERVAL_MINUTES`, default 1440 until cron cadence improves).
4. **Alert delivery:** posts to the pilot channel only (`baxter_alert_settings`, seed from env `SLACK_ALERT_CHANNEL_ID`). One alert per finding: project/record, what, evidence ("as of <sync/probe time>"), consequence when known, recommendation, proposed next step naming the responsible role's assigned person (from Prompt 1 assignments; fall back to role name). Respect quiet hours (hold, deliver after). Digest mode: multiple findings in one sweep post as a single grouped message. LLM phrasing through the existing provider with the governance system prompt; deterministic fallback template on failure. Never DM anyone in this iteration — channel only, matching the pilot posture.
5. **Acknowledgment + escalation:** subscribe to `reaction_added` (extend the Slack events route with a dedicated handler — do not touch `shouldIgnoreSlackEvent`'s Q&A guard) — ✅ on an alert marks acknowledged; ❌ marks `dismissed_false_positive`. A threaded reply also acknowledges. Escalation: an `open`+alerted finding past `escalation_window_minutes` gets one follow-up mention of the Accountable role's person in-thread, once. Document required new Slack scopes (`reactions:read`) and manifest changes.
6. **Admin `/admin/baxter/monitoring`:** settings editor; run history; findings table with status filters; metrics — alerts sent, acknowledged, auto-resolved, false-positive rate (the governance success metric). Follow existing admin conventions.
7. **Capabilities honesty:** update `governance/capabilities.ts` to claim proactive monitoring only when monitoring is enabled and an active rulebook exists.

### Test

- Unit tests: each check against fixture data (finding produced / not produced / threshold edge); dedupe and auto-resolve transitions; quiet-hours and digest logic; escalation once-only; reaction handler mapping; deterministic fallback template; settings gating.
- Extend the pattern of `tests/unit/prompt5b-slack-production.test.ts` for the Slack pieces.
- Run `npm run format && npm run lint && npm run typecheck && npm run test`.

### Report manual setup steps

Checklist to include: migration 023; add `reactions:read` scope + reinstall Slack app; create the private pilot alert channel, invite Baxter and the four pilot members, set `SLACK_ALERT_CHANNEL_ID`; set `BAXTER_MONITOR_INTERVAL_MINUTES`; **cron cadence decision** — Vercel Hobby allows only daily cron, so either upgrade to Pro and set the `vercel.json` schedule to e.g. `*/30 * * * *`, or add a GitHub Actions scheduled workflow that POSTs to `/api/internal/process-jobs` with the `CRON_SECRET` bearer (provide the workflow YAML in your report); confirm quiet-hours/escalation defaults with the team (governance PLACEHOLDERs). Update `docs/baxter-roadmap.md`, `docs/production-checklist.md`, and add `docs/baxter-monitoring.md`.

---

## Prompt 3 — Project Data Ingestion Spine (Buildertrend-ready) + Timeline Monitoring

Copy everything below into Cursor as one prompt. Requires Prompts 1–2. The Buildertrend official-API answer may still be pending — this prompt is deliberately buildable without it.

---

You are working in the Acton ADU Baxter repo. Read `AGENTS.md` first. Inspect before building:

- `docs/` project brief materials and `docs/baxter/baxter-governance-v1-1.md` — the Buildertrend decision ladder (official API → scheduled report exports → managed adapter → browser automation) and the architectural default: **Baxter reads from a daily-synced datastore he owns, never live from Buildertrend.**
- `src/lib/connectors/registry.ts`, `src/lib/connectors/google/` (sync runs, file ingestion), `src/lib/connectors/ghl/` (connector structure, health model) — follow the established connector shape.
- `src/lib/rulebook/` — `process_stages.external_stage_name` exists precisely for exact Buildertrend stage-name matching; unmatched names must surface, not silently drop.
- `src/lib/monitoring/` (Prompt 2) — you are adding checks to an existing registry, not building a new engine.

### Goal

A normalized project/stage datastore with a pluggable ingestion source, so the moment Buildertrend access lands (any rung of the ladder) the data flows into monitoring that is already written and tested. Ship the CSV/Drive-export rung now — "a daily CSV landing in a folder Baxter reads is ugly, boring, and nearly unbreakable" — plus fixtures, and stub the official-API client behind config. Then extend monitoring with the three Phase 1b check families: timeline slippage, skipped steps, downstream consequences.

### Build

1. **Migration `024_project_sync.sql`:** `bt_projects` (external id, name, current stage, status, dates, raw_json), `bt_project_stage_snapshots` (project, stage name, entered_at/days_in_stage as reported, snapshot_at — append-only history), `bt_sync_runs` (source `csv_drive|api|fixture`, started/finished, rows, status, error, freshness watermark). RLS admin-only.
2. **`ProjectDataSource` interface** in `src/lib/connectors/buildertrend/` with three implementations: (a) **fixture** for tests/dev; (b) **`csv_drive`** — reads the newest export file from a configured Drive folder via the existing Google connector auth (folder id in config), with a documented expected-column contract and a tolerant parser that reports unknown/missing columns; (c) **`api`** — typed stub that throws `NOT_CONFIGURED` until credentials exist (`BT_SOURCE=api`), so wiring is ready for the support answer. Source selected by env `BT_SOURCE` (`none` default).
3. **Sync job:** new job type `buildertrend_sync`, scheduled like the Google sync (interval env). Normalization maps external stage names to rulebook `external_stage_name`; unmatched stage names are recorded on the sync run and surfaced as a `feed_health`-family finding ("3 Buildertrend stage names don't match rulebook v4 — monitoring is blind there"), because a silent mismatch is exactly how Baxter goes blind where mistakes happen.
4. **Freshness discipline:** every downstream consumer gets the watermark. Stale feed (no successful sync in > 1.5× interval) triggers the existing `feed_health` alert. All project answers/alerts say "as of last sync <time>" — never present synced data as real-time (runtime prompt rule).
5. **New monitoring checks** (deterministic, registered in Prompt 2's registry): `bt_timeline_slippage` — days_in_stage vs. rulebook stage `duration_days_budget`, alert at configurable percentage and again at exceeded; `bt_skipped_step` — project entered a stage while a prior stage's required data (rulebook data requirements with `source_system='buildertrend'`, plus GHL-side requirements) is missing; `bt_downstream_consequence` — when slippage exists, include the next dependent stage and the push duration in the finding's consequence field (data already in the rulebook ordering + budgets; no new engine).
6. **Q&A integration:** a project-status evidence provider ("where is the Ramirez project?") reading the synced datastore, merged like GHL evidence, citing "Buildertrend sync <date>". Capabilities block updated conditionally on `BT_SOURCE !== 'none'` and a recent successful sync.
7. **Admin:** `/admin/connectors/buildertrend` — source mode, last runs, freshness, unmatched-stage report, column-contract doc link. Register in `/admin/connectors` overview.

### Test

- Unit tests: CSV parser contract (good file, missing columns, extra columns, empty), stage-name matching + unmatched reporting, snapshot append semantics, freshness/staleness detection, each new check against fixtures (on-budget, warning threshold, exceeded, skipped-step, consequence text), capabilities gating.
- Run `npm run format && npm run lint && npm run typecheck && npm run test`.

### Report manual setup steps

Checklist to include: migration 024; the Buildertrend side — confirm the support answer on official API scope (rung 1) and if unavailable configure a scheduled report export into a dedicated Drive folder (document the exact report/columns to schedule, matching the parser contract); set `BT_SOURCE` and the Drive folder id; add the folder to the Google connector's access; Milan's explicit sign-off before any rung-3/4 (login-based) path is ever attempted — do not build rungs 3/4; rulebook update filling `external_stage_name` for every stage (Maxx). Update `docs/baxter-roadmap.md` and add `docs/buildertrend-connector.md`.
