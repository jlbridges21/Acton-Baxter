# Partnership Evaluation Meeting NEAT — Module Record

The single-page source of truth. Everything here should be checkable in under a minute.

---

## Identity

| Field                   | Value                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| Module name             | Partnership Evaluation Meeting NEAT                                             |
| Short name              | PEM NEAT                                                                        |
| Registry key            | `pem-neat` (in `src/lib/baxter/tools.ts`)                                       |
| What NEAT stands for    | **N**otes, **E**mail, **A**ssessment, **T**ranscript                            |
| Type                    | Baxter capability, not a standalone application                                 |
| Status                  | In production use                                                               |
| Risk tier               | **High** — processes customer PII and produces employee performance assessments |
| Standard version        | 1.0.0                                                                           |
| First shipped           | 28 July 2026                                                                    |
| Last substantive change | 10 August 2026 (multi-prospect names)                                           |

## Ownership

| Role                   | Person              | Responsibility                                                      |
| ---------------------- | ------------------- | ------------------------------------------------------------------- |
| Module owner           | **GAP — not named** | Accuracy of the grading standard, review cadence, cost, gap closure |
| Technical owner        | **GAP — not named** | Code, pipeline, provider configuration, incidents                   |
| Grading standard owner | **GAP — not named** | The thirteen governance sections; the sales methodology itself      |
| Approver               | **GAP — not named** | Signs off changes to grading or scoring                             |

> Naming an owner is gap 1 in the [Specification](./02-specification.md#gaps-to-resolve) and blocks the rest. Until someone is accountable, nobody is reviewing grading accuracy, nobody is watching cost, and nobody is closing the other gaps. The sensible split is a sales leader owning the grading standard and a technical owner owning the pipeline, because those are genuinely different jobs.

## Users

Acton sales advisors, sales managers, and administrators. Any signed-in Baxter user with app access can create, read, edit, and regenerate any PEM NEAT.

## Where things live

| Thing                           | Location                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Code                            | `src/lib/pem-neat/`, `src/app/pem-neats/`, `src/app/api/pem-neats/`, `src/components/pem-neat/` |
| Chat data layer                 | `src/lib/baxter-data/pem-neats/`                                                                |
| Database tables                 | `public.pem_neats`, `public.pem_neat_generations`                                               |
| Migrations                      | 025, 027, 028, 042 (plus 043 for the governance surface)                                        |
| **The grading standard (live)** | **Database — Admin → Baxter Governance → `pem_neat_grading`**                                   |
| Grading standard (fallback)     | `src/lib/baxter-ai/governance/pem-neat-grading-meta.ts`                                         |
| Tests                           | `tests/unit/pem-*`, `tests/integration/pem-*`, `tests/e2e/pem-neat.spec.ts`                     |
| Background reference            | `docs/pem-neat/` (reference only; the live standard is in the web app)                          |

## The originating prompt and the current prompt

The playbook asks every module record to carry both.

**Originating prompt.** The module's original system prompt is preserved as the compiled defaults in `src/lib/baxter-ai/governance/pem-neat-grading-meta.ts`. Those defaults are documented in that file as byte-identical to the pre-governance system prompt, which makes them an exact record of what the module started as.

**Current prompt.** The live prompt is assembled at generation time from thirteen governance sections read fresh from the database, wrapped in per-stage instructions from `src/lib/pem-neat/prompts.ts`. The per-stage text is reproduced verbatim in the [Code Reference](./03-code.md#prompt-assembly).

> **The live grading text is not in version control.** It is database content, editable by an administrator, and the only copy is in the Baxter database. Export it to this folder on every quarterly review. See [Code Reference § Extracting a complete current bundle](./03-code.md#extracting-a-complete-current-bundle).

Each generation records which governance version it used (`analysis_metadata.gradingContentVersionNumber`) and whether it fell back to compiled defaults (`usedCompiledGradingFallback`), so any result can be traced to the standard that produced it.

## Configuration

| Variable                         | Purpose                                     | Default                          |
| -------------------------------- | ------------------------------------------- | -------------------------------- |
| `OPENAI_API_KEY`                 | Provider credential                         | required                         |
| `PEM_NEAT_OPENAI_MODEL`          | Primary model override                      | falls through to Baxter defaults |
| `PEM_NEAT_OPENAI_FALLBACK_MODEL` | Fallback model                              | unset                            |
| `PEM_NEAT_REASONING_EFFORT`      | Default reasoning effort                    | `medium`                         |
| `PEM_NEAT_MAX_OUTPUT_TOKENS`     | Per-stage cap, clamped 2,000–64,000         | per-stage budgets                |
| `PEM_NEAT_TIMEOUT_MS`            | Per-stage timeout, clamped 30,000–300,000   | overall 900,000 ms               |
| `ENABLE_MOCK_RESEARCH`           | Fabricated results instead of real analysis | **`true`** — see gap 3           |
| `ENABLE_SLACK_INTEGRATION`       | Gates the `/pem` command                    | —                                |

## Cost

Six model calls per generation in the normal path. Up to twenty-eight in the worst case with retries, recovery, and corrections. Token counts and latency are recorded per generation.

**Not monitored.** The [Runbook](./08-runbook.md#cost) has the queries to measure it by hand.

## Dependencies and blast radius

**This module depends on:** Supabase (Postgres, RLS, service role), OpenAI, the Baxter durable job queue, Baxter authentication, the Baxter governance content store, and optionally Slack.

**These depend on this module:** Baxter chat answers about customers and meetings, the Customer Center dossier, admin diagnostics, and launch readiness. All of them read stored results; none of them trigger generation. If PEM NEAT stops generating, those surfaces keep working on existing data.

**Deliberately not connected:** New Project Setup. A meeting marked `YES` does not create a project. See [ADR-007](./05-adrs.md#adr-007).

## Open gaps

Four launch-blocking, six other. See the [Specification](./02-specification.md#gaps-to-resolve) for the full table with severity.

The four that matter most: no owner named; every authenticated user can read every transcript; mock mode defaults on outside production without visible labelling; and the hard-fail validation path is declared but not wired, so a fabricated quotation is saved like any other result.

## Review

| Activity                                      | Cadence             | Last done                              |
| --------------------------------------------- | ------------------- | -------------------------------------- |
| Documentation review                          | Quarterly           | **Never** — this document is the first |
| Grading accuracy review against real meetings | **Not established** | **Never**                              |
| Cost review                                   | **Not established** | **Never**                              |
| Export live grading standard to this folder   | Quarterly           | **Never**                              |
