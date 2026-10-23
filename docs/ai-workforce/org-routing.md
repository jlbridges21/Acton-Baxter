# Baxter organization routing

How Baxter answers questions about its AI team, delegates work to agents, and tells an agent's
name apart from a person or a CRM record. This applies to both Slack and web; both go through
`answerBaxterQuestion`.

## The bug it fixes

"Who is Sam?" searched GoHighLevel and gave a generic answer. Three causes combined:

1. Nothing in the pipeline knew which agents exist before routing ran.
2. The delegation router only recognised task forms like "ask/have/tell Sam …".
3. A question about Sam therefore reached semantic classification, which treats any "who is X"
   as an entity lookup. The evidence registry then queried GoHighLevel.

## Where it runs

`answerBaxterQuestion` (`src/lib/baxter-ai/answer.ts`) calls `routeOrganizationRequest`. This
happens after commands, governance checks and conversation history, and before delegation and
before any CRM or knowledge search.

| File                            | Role                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/agents/directory.ts`   | Builds the live org directory from the Agent Registry (active, published agents only), plus tool readiness and requester access. Nothing is hardcoded. |
| `src/lib/agents/intent.ts`      | `interpretOrgRequest`, a pure, deterministic interpreter that makes no model call.                                                                     |
| `src/lib/agents/org-answers.ts` | Grounded answers built from the registry and real readiness checks, formatted for Slack or web.                                                        |
| `src/lib/agents/org-routing.ts` | Glue code and the trace. Returns either a finished answer or a resolved question for the next stage.                                                   |
| `src/lib/agents/org-eval.ts`    | Evaluation cases and the scoring rubric.                                                                                                               |
| `src/lib/agents/org-quality.ts` | Data for the admin quality view.                                                                                                                       |

### Intents

| Intent                 | Example                                                                             | What Baxter does                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `agent_info`           | "Who is Sam?", "Is Sam able to look up employee info in BambooHR?"                  | Answers from the registry: role, reporting line, tasks. Adds live readiness when the user asks about current ability. |
| `agent_can_help`       | "Can Dexter help with onboarding?"                                                  | Checks the topic against the agent's published card and suggests a better-fitting agent when there is one.            |
| `agent_status`         | "Is Dexter working on anything?"                                                    | Lists open tasks. Non-admins see only their own requests.                                                             |
| `org_roster`           | "Which agents do you have?", "Which agent handles HR?"                              | Lists the team, or the best-fitting agent. If no agent fits, says so.                                                 |
| `capability_inventory` | "What tools do you have?"                                                           | Separates systems that are working from those configured but not working.                                             |
| `agent_task`           | "Ask Sam to …", "Sam, …", "Ask her …"                                               | Hands off to the existing delegation router, with pronouns resolved.                                                  |
| `clarify`              | "Who is Sam?" right after a CRM conversation, or when an employee is also named Sam | Asks one question: the agent or a person? The next turn uses the answer.                                              |
| `none`                 | "Who is Sam in GoHighLevel?", "Phone number for Sam Johnson"                        | Runs the normal pipeline. When the agent's name refers to a record, name-based delegation is skipped.                 |

### Discovery

- **Agents:** `listResolvedAgents()` is read at request time, using the registry's short cache. A
  new agent becomes known as soon as it is published in AI Studio. The test "discovers a newly
  published agent" creates "Olivia" at runtime to prove this.
- **Tools:** each `AgentTool` can declare `source` and `readiness()`. Families of tools share
  default checks, for example `reports_*` uses JobTread configuration and `bamboohr_*` uses the
  BambooHR connection status. "Can do" means the tool is enabled for the agent and its readiness
  check passes. Anything else is reported as "not working yet", with the reason.

### Safety

- The interpreter never grants access. Delegation and tools still apply their own access policies
  and approvals.
- Access text is honest. An employee without access to Sam is told so, and is not offered a
  hand-off.
- Traces store strategy, intent, agent slug, a short reason and latency. The admin view shows
  counts only. It never shows message text or the reason, because the reason can quote the
  question.

## Evaluation

Run it with:

```bash
EVAL_REPORT_PATH=/tmp/org-eval.json npx vitest run tests/unit/baxter-org-eval.test.ts
```

For the baseline, set `BAXTER_ORG_ROUTING=off`.

Each case runs through `answerBaxterQuestion`. GoHighLevel is stubbed so that CRM searches are
counted, not sent. Each turn is scored on four things:

- **Route:** registry answer, delegation to the named agent, CRM lookup, clarification, or the
  rest of the pipeline.
- **No CRM:** no GoHighLevel search when none is needed.
- **Required phrases:** all present.
- **Forbidden phrases:** none present.

Markdown and Slack emphasis is ignored when matching phrases.

Results as of 2026-10-23:

| Set                                     | Baseline (off)         | New layer                |
| --------------------------------------- | ---------------------- | ------------------------ |
| Main (19 cases, 23 turns)               | 5/23 turns, 4/19 cases | 23/23 turns, 19/19 cases |
| Held-out 1 (13)                         | 3/13                   | 13/13                    |
| Held-out 2 (13 cases, 14 turns)         | 3/14                   | 14/14                    |
| Unnecessary GoHighLevel searches (main) | 5                      | 0                        |

Read these numbers with two caveats:

- **Held-out 1 is not independent.** Its failures were used to fix the interpreter: "Tell me
  about…", "should I ask about…", ability questions, and skipping delegation for CRM records.
  Held-out 2 was written after those fixes and was never tuned; it passed on its first run.
- **Baseline answer text is understated.** The tests use no live model, so the baseline's LLM
  stages fail and fall back. The route and CRM-search measurements do not depend on the model.
  For example, the baseline really did search GoHighLevel for "Who is Sam?". But some baseline
  phrase checks would score better against a working model.

Main-set baseline by category:

| Category         | Baseline |
| ---------------- | -------- |
| Agent awareness  | 0/9      |
| Capability truth | 0/2      |
| Follow-ups       | 0/3      |
| Permissions      | 0/1      |
| Disambiguation   | 3/5      |
| Delegation       | 2/2      |

Regression tests are in `tests/unit/baxter-org-routing.test.ts`:

- The four required cases.
- Runtime agent discovery.
- Pronoun follow-ups.
- Clarification.
- Skipping delegation for CRM records.
- Slack formatting.
- The trace.
- The admin view.
- The kill switch.

## Admin view

**Admin → Baxter → Evaluations** has an "Organization routing" card with three parts:

- Intent checks: the first turn of every case, run against the live registry with no side
  effects.
- Route, intent and agent counts from the last 200 routed answers.
- Median routing latency.

## Models

The organization layer makes no model calls, so it adds no model latency or cost. The model is
unchanged:

- Baxter's main pipeline still uses its environment-configured model (`BAXTER_OPENAI_MODEL`, or
  else `OPENAI_MODEL`, with `BAXTER_LLM_PROVIDER`).
- Specialists still use the model in their published config.

Recommendation: before changing the production model, run the admin Evaluations suite against a
staging deployment with each candidate model. Compare the
results on the same cases.

## Configuration

| Variable             | Default | Effect                                                                  |
| -------------------- | ------- | ----------------------------------------------------------------------- |
| `BAXTER_ORG_ROUTING` | on      | Set to `off` to restore the previous behaviour. No migration is needed. |

Agents, titles, specializations, supported tasks, keywords and reporting lines all come from AI
Studio. Changing them there changes Baxter's answers without a deploy.

## Limitations

- The interpreter uses patterns plus the registry, not a model. Unusual phrasing falls through to
  the existing pipeline, which behaves as it did before. Every case it doesn't handle can be added
  to `org-eval.ts`.
- Topic matching ("which agent handles X") uses word overlap with the agent's card, with no
  synonyms. For example, "payroll" will not match an agent whose card says "compensation".
  Adding keywords in AI Studio fixes this.
- Clarification uses employee first names from profiles, cached for 60 seconds. It does not use
  CRM contact names; recent CRM conversation is used as a signal instead.
