# AI Workforce (Phase 1) — implementation summary

Baxter becomes the **AI CEO** and gains a first specialist, **Sam (HR, Administration & Legal)**. Admins manage the AI organization at `/ai` without code.

| Guide                                    | For                                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| [architecture.md](architecture.md)       | Audit findings, design, data model, libraries evaluated |
| [admin-guide.md](admin-guide.md)         | Plain-English how-tos for administrators                |
| [developer-guide.md](developer-guide.md) | Adding tools, integrations, providers                   |
| [security.md](security.md)               | Permissions, data boundaries, approvals                 |
| [operations.md](operations.md)           | Deploying, monitoring, troubleshooting, costs, recovery |

## Features implemented

- **Delegation runtime**: explicit mention → rules pre-screen → AI router for borderline requests; authorization before every hand-off; durable tasks with event logs, idempotency, retries, background recovery, cancellation, limits, loop detection; structured specialist results with citation filtering.
- **Shared channels**: web chat and Slack both go through `answerBaxterQuestion()` → `maybeDelegateBaxterRequest()`. Slack uses verified identity mapping and keeps HR answers out of public channels. Direct agent chat and sandbox tests use the same executor.
- **Sam's tools**: approved-document search, onboarding templates, onboarding progress, communication drafts (→ Approvals; never sent), flag for human review.
- **Agent Studio**: profile and portrait (crop/upload to Storage), instructions (with protected rules), AI model (capability-aware catalog, connection test, backup model, safety limits), delegation (examples, key phrases, tester, regression suite), tools, access policies, version history (compare/restore), sandbox test, direct chat. Draft → preview → publish with audit trail.
- **Agent wizard**: create additional agents (and departments) from the UI.
- **Knowledge Hub**: upload, categorize, assign to agents, sensitivity levels, indexing status, preview, search-as-agent, replace, archive, delete (admin).
- **Onboarding**: template editor (reorder, owners, due offsets, dependencies, documents, notification text), new-hire progress tracking. A clearly labelled **placeholder** template is seeded.
- **AI Office**: pixel-art office driven only by real task state (Realtime + 15 s fallback), pan/drag, zoom, keyboard controls, agent profiles, activity feed, reduced-motion toggle, accessible list view, layouts/themes/room names.
- **Tasks, Approvals, Mission Control** pages; delegation trace in Baxter's chat.

## Files

**Created**

- `supabase/migrations/067_ai_workforce.sql`
- `src/lib/agents/*` — runtime, data access, permissions, router, models, executor, tools, knowledge, onboarding, approvals, admin, views, jobs
- `src/app/api/ai/**` — 34 route handlers
- `src/app/ai/**` — AI Office, Agents, Agent Studio, wizard, Knowledge Hub, Onboarding, Tasks, Approvals, Mission Control, Customize office
- `src/components/ai/*`, `src/components/baxter-chat/baxter-delegation-trace.tsx`
- `tests/unit/agents-runtime.test.ts`, `agents-config.test.ts`, `agents-units.test.ts`, `agents-test-helpers.ts`, `tests/e2e/ai-workspace.spec.ts`
- `docs/ai-workforce/*`
- `.claude/launch.json` (local sandbox dev server: in-memory data, no provider keys)

**Modified** (small, additive)

- `src/lib/baxter-ai/answer.ts` — delegation step after safety checks
- `src/lib/baxter-ai/types.ts`, `conversations.ts`, `classify.ts` — delegation trace field, message metadata, `agent_knowledge` source kind
- `src/lib/slack/baxter-events.ts` — passes channel/thread/DM info
- `src/app/api/baxter/chat/route.ts` — returns the delegation trace; `maxDuration = 300`
- `src/components/baxter-chat/baxter-chat-message.tsx`, `baxter-chat-panel.tsx` — render the trace
- `src/lib/jobs/types.ts`, `process.ts` — `ai_agent_task` job + stale-task recovery
- `src/lib/baxter/admin-nav.ts`, `app-nav-links.ts` (+ nav test) — "AI Workspace" link
- `src/app/globals.css` — office styles
- `playwright.config.ts` — E2E server never inherits a live Anthropic key

**Dependencies added:** none.

## Environment variables

None new are required. Optional: `AI_WORKFORCE_DELEGATION_ENABLED=false` (kill switch). Sam uses `ANTHROPIC_API_KEY` by default.

## Tests run (2026-10-22)

| Check                                   | Result                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format` / `lint` / `typecheck` | Pass (5 pre-existing lint warnings in untouched files)                                                                                                                                                                  |
| `npm run build`                         | Pass                                                                                                                                                                                                                    |
| AI Workforce unit tests (44)            | Pass                                                                                                                                                                                                                    |
| AI Workspace E2E (6, headless Chromium) | Pass                                                                                                                                                                                                                    |
| Full unit suite                         | 1,994 pass; **45 fail in 6 pre-existing files** (inventory, dashboard tools, project-status filter, site-inspection) because `localStorage` is undefined in the test environment — identical failures without this work |
| Migration                               | Applied cleanly (twice) to a scratch local Postgres 17 with Supabase stubs; cycle trigger verified. **Not applied to production.**                                                                                      |
| Live model calls                        | **None made.** Real Claude/OpenAI behavior of Sam has not been exercised yet.                                                                                                                                           |

## Known limitations

- Sam hasn't been run against a live model in this environment; first live runs should be sandbox tests on the Test tab.
- No approved Acton HR SOPs are loaded; Sam will report missing information until documents are uploaded.
- Retention policy for tasks/audit is not automated.
- Lexical knowledge search reads up to 4,000 chunks per query (fine for an HR handbook; revisit past ~1,000 documents).
- The office seats up to four agents per room.
- OpenAI prices in cost estimates are list-price approximations.
- Registry changes reach other server instances within 30 seconds.

## Deferred capabilities

Email sending, autonomous reminders, offboarding execution, access revocation, payroll, BambooHR, Sam's own Slack bot, contract execution, legal approval workflows.

## Next steps

1. Apply the migration; grant HR staff access to Sam.
2. Upload Milan's briefing, SOPs, and onboarding checklist; replace the placeholder template and mark it official.
3. Run sandbox tests and add real employee phrasings to Sam's delegation examples; run the regression check.
4. Decide retention periods; then plan BambooHR read access and approved email sending.
