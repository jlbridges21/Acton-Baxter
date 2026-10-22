# AI Workforce — architecture

Phase 1 adds an AI organization to Baxter: **Baxter (AI CEO)** orchestrates, and **Sam (HR, Administration & Legal specialist)** is the first specialist. Everything an administrator normally changes lives in Supabase and is edited in the app at `/ai`.

## 1. What existed before (audit, 2026-10-22)

| Area              | Finding                                                                                                                                                                                                                      | Reused?                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Framework         | Next.js 16.2 App Router (Turbopack), React 19.2, TypeScript, Tailwind 4, Zod 4, Vitest + Playwright                                                                                                                          | Yes                                                                             |
| Auth              | Supabase Auth; `profiles.role` ∈ `new_user` / `user` / `admin` / `super_admin`; `requireActiveUser()` / `requireAdmin()`; E2E bypass cookie for tests                                                                        | Yes — `requesterFromAuthUser()` wraps it                                        |
| Human departments | `departments` table + `profiles.department_id`                                                                                                                                                                               | Yes — access grants by department use these                                     |
| Baxter AI         | `answerBaxterQuestion()` in `src/lib/baxter-ai/answer.ts` is the single entry point for **web and Slack**. Deterministic classification → GHL / Slack / knowledge retrieval → one LLM call                                   | Kept intact. Delegation is a new step inside it                                 |
| Providers         | Raw-`fetch` OpenAI (capability-aware Responses vs Chat Completions builder in `src/lib/openai/`) and Anthropic providers; env-selected (`BAXTER_LLM_PROVIDER`, `BAXTER_CHAT_MODEL`, …)                                       | The OpenAI request builder is reused; Baxter's env model is kept as its default |
| Knowledge         | `knowledge_entries` / `knowledge_units` with pgvector embeddings, hybrid retrieval, upload parsers (PDF/DOCX/XLSX/CSV/MD)                                                                                                    | Parser, chunker, and embedding helpers reused. **Storage is separate** (see §4) |
| Slack             | Events API → `slack_baxter_reply` jobs → `answerBaxterQuestion(channel: "slack", userId: null)`; Slack→Baxter identity via `resolveBaxterUserForSlackIdentity()` (search connection, mapping table, or Slack-verified email) | Yes — used only when a request is routed to a specialist                        |
| Background jobs   | `report_jobs` queue + Vercel cron every 2 min (`/api/internal/process-jobs`, `maxDuration` 800s), stale-job reclaim                                                                                                          | Yes — new `ai_agent_task` job type                                              |
| Realtime          | Not used elsewhere                                                                                                                                                                                                           | Added for one non-sensitive table                                               |
| Audit             | Domain-specific audit tables (GHL, rulebook)                                                                                                                                                                                 | New `ai_audit_log`                                                              |
| UI                | Acton design tokens, `Button`/`Card`/`Badge`/`Dialog`, `AppShell` nav, `@xyflow/react` already installed                                                                                                                     | Yes                                                                             |
| Avatar            | The portrait is at **`public/baxter/avatar.png`** (served as `/baxter/avatar.png`). The brief's paths `/public/Baxter avatar.png` and `/public/Baxter/avatar.png` do not exist.                                              | Referenced in place; not copied or renamed                                      |

Observations worth acting on (not changed by this work):

- `BAXTER_ANTHROPIC_MODEL` in `.env.local` is a Claude 3.5 Haiku ID, which is likely retired; Baxter's Anthropic **fallback** may fail when OpenAI is down.
- 45 existing UI unit tests (inventory, dashboard tools, project-status filter, site-inspection) fail on `main` because `localStorage` is undefined in the test environment. They fail identically without this work.
- `/api/baxter/chat` maps request-validation errors to HTTP 502 instead of 400.

## 2. Libraries evaluated

| Option                                      | Decision                 | Why                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI Agents SDK (MIT)                     | Not used                 | Would add a second execution path beside Baxter's raw-fetch providers; Anthropic support needs an adapter; two agents don't need a framework.                                                          |
| LangGraph                                   | Not used                 | Graph orchestration is overkill for manager → one specialist with depth 1.                                                                                                                             |
| Agent Campus (MIT; Electron + React canvas) | Visual reference only    | Desktop app that runs Claude Code sessions — its runtime must not ship to Vercel. No code or art was copied.                                                                                           |
| PixiJS                                      | Not used                 | A DOM/CSS pixel office gives real, focusable buttons for each agent (accessibility), uses PNG portraits directly, and adds zero bundle weight. PixiJS becomes worth it with dozens of animated agents. |
| React Flow (`@xyflow/react`)                | Used (already installed) | Org chart.                                                                                                                                                                                             |

**No new npm dependencies were added.**

## 3. Runtime

```
web chat ─┐                       ┌─ explicit mention ("ask Sam")
Slack ────┼─► answerBaxterQuestion ─► maybeDelegateBaxterRequest ─► router ─┼─ rules pre-screen (examples/keywords from DB)
          │   (unchanged pipeline    │                                       └─ AI router for borderline requests only
          │    if not delegated)     │
          │                          ├─ resolve requester (web session / verified Slack mapping)
          │                          ├─ authorize (use_via_baxter) · privacy (no HR in public Slack channels)
          │                          ├─ createTask (idempotent per user message)
          │                          └─ executeSpecialistTask ─► bounded tool loop ─► SpecialistResult
          └──────────────────────────── Baxter composes the reply + delegation trace
```

Key files (`src/lib/agents/`):

| File                                                                                  | Responsibility                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `types.ts`                                                                            | Zod schemas for the editable agent config, row types, the specialist output contract                  |
| `store.ts`                                                                            | Table access: service-role Supabase in production, in-memory in tests/mock mode                       |
| `seed.ts`, `defaults.ts`                                                              | Idempotent first-run creation of Baxter, Sam, departments, placeholder onboarding template            |
| `registry.ts`                                                                         | Loads agents + validated **published** config (30 s per-instance cache, cleared on publish)           |
| `permissions.ts`                                                                      | Access levels per agent; admins implicit; unverified requesters get nothing                           |
| `router.ts`, `text.ts`                                                                | Delegation routing                                                                                    |
| `models.ts`                                                                           | Model catalog, capability flags, cost estimates, `callAgentModel()` with optional configured fallback |
| `executor.ts`                                                                         | Specialist loop, limits, cancellation, loop detection, citation filtering                             |
| `tools.ts`                                                                            | Tool registry (code-defined), risk levels, approval minimums                                          |
| `orchestrator.ts`                                                                     | The shared entry point for all channels                                                               |
| `tasks.ts`, `jobs.ts`                                                                 | Task lifecycle, runtime status, background retry/recovery                                             |
| `knowledge.ts`, `onboarding.ts`, `approvals.ts`, `admin.ts`, `views.ts`, `testing.ts` | Feature modules                                                                                       |

### Routing

1. **Explicit**: "ask Sam …", "@Sam …", "have Sam …".
2. **Rules**: cosine similarity between the request and each specialist's _positive_ and _negative_ example requests, plus key-phrase hits. Clear matches and clear non-matches are decided without any model call.
3. **AI router** (hybrid mode only): one small JSON call using Baxter's model, given each specialist's capability card. It can also split mixed requests. If it fails, the rules decision is used.

Routing never grants access; authorization happens afterwards.

### Specialist execution

Provider-agnostic JSON protocol (`{"action":"tools",…}` / `{"action":"final",…}`), so OpenAI and Anthropic behave the same. Enforced in code:

- maximum iterations, tool calls, tokens, estimated cost, and wall-clock time (per-agent, editable within hard caps);
- interactive callers cap the inline run (Slack 40 s, web 120 s); overruns re-queue and finish in the background (Slack gets a thread follow-up);
- repeated identical tool calls are refused (loop detection);
- only enabled + available tools run; draft/review tools always create approval requests;
- cancellation is checked before every step;
- the final result must match `specialistResultSchema`; citations not returned by a tool are dropped.

Current Claude models reject non-default sampling parameters, so Anthropic requests send no `temperature`; depth is controlled with `output_config.effort`.

### Task lifecycle

`queued → running → (completed | awaiting_approval → completed | failed | cancelled)`, `failed → queued` (manual retry). Transitions are conditional updates on the current status, so two workers can't both run an attempt. Each task records requester, assigning/assigned agent, config version, routing explanation, result, error, model, tokens, estimated cost, attempts, and an event log (no model reasoning, no document text).

**Runtime status** (`ai_agent_runtime_status`) is _derived from tasks_ after every transition — the AI Office animates only from this, so there is no decorative "fake work". Baxter shows "Waiting on a specialist" while Sam works.

### Background execution and recovery

- Retryable provider errors and inline timeouts → task back to `queued` + `ai_agent_task` job.
- The existing cron sweep re-queues `running` tasks whose lease expired (crashed/timed-out function) and enqueues `queued` tasks idle for 5 minutes.
- Requester access is re-loaded from the database before any background attempt, so revoked access takes effect.

## 4. Data model (migration `067_ai_workforce.sql`)

| Table                                                                            | Purpose                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ai_departments`                                                                 | Office/agent departments (separate from human `departments`)                                                  |
| `ai_agents`                                                                      | Identity, kind, manager (cycle-checked by trigger), status, avatar, desk                                      |
| `ai_agent_config_versions`                                                       | Versioned config; at most one draft and one published per agent; `publish_ai_agent_config()` swaps atomically |
| `ai_agent_access_policies`                                                       | Grants by role / user / department × access level                                                             |
| `ai_tasks`, `ai_task_events`                                                     | Durable assignments and execution log                                                                         |
| `ai_agent_runtime_status`                                                        | Non-sensitive live state (Realtime-published)                                                                 |
| `ai_approval_requests`                                                           | Human review queue (communication drafts, review flags)                                                       |
| `ai_knowledge_documents`, `ai_knowledge_document_agents`, `ai_knowledge_chunks`  | Specialist knowledge, isolated from Baxter's general knowledge                                                |
| `ai_onboarding_templates`, `…_template_steps`, `…_instances`, `…_instance_steps` | Onboarding workflows                                                                                          |
| `ai_workspace_settings`                                                          | Office layout/theme/labels                                                                                    |
| `ai_audit_log`                                                                   | Who changed what (no document bodies, no secrets)                                                             |

Storage buckets: `ai-agent-avatars` (public read, server-only writes) and `ai-agent-knowledge` (private; 60-second signed URLs after authorization).

RLS is enabled on every table. Browser sessions can read only directory metadata, departments, workspace settings, and runtime status. Everything else is server-only.

## 5. Channels

| Channel                                 | Identity                                                    | Notes                                                          |
| --------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Web chat                                | Supabase session                                            | Delegation trace shown under the answer                        |
| Slack                                   | `resolveBaxterUserForSlackIdentity()` — never display names | HR results only in DMs unless the agent allows public channels |
| Direct chat (`/ai/agents/sam?tab=chat`) | Supabase session, needs `direct_chat`                       | Same executor and checks                                       |
| Sandbox (`Test` tab)                    | Agent managers                                              | Real model + retrieval; never saves drafts or approvals        |

## 6. Not built (deferred by design)

Automated email sending, autonomous reminders, offboarding execution, access revocation, payroll, BambooHR read/write, a separate Slack bot for Sam, contract execution, legal approval workflows. Planned tools appear in the Tools tab as "Coming later" and cannot be enabled.
