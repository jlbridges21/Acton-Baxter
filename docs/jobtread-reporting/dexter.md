# Dexter and delegation

## 9. Dexter agent configuration

| Setting        | Value                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Name / slug    | Dexter / `dexter`                                                                                                                |
| Title          | AI Reporting & Data Analytics Specialist                                                                                         |
| Department     | Business Intelligence & Analytics (`business-intelligence`, teal)                                                                |
| Reports to     | Baxter                                                                                                                           |
| Model          | Anthropic `claude-opus-5-5`, medium effort, 16k max output (editable in AI Studio → Dexter → Model)                              |
| Limits         | 8 iterations, 12 tool calls, 200 s, 300k tokens, $2 per request                                                                  |
| Avatar         | Initials placeholder ("D") — upload a portrait in AI Studio                                                                      |
| Tools          | `reports_list_fields`, `reports_preview`, `reports_aggregate`, `reports_list`, `reports_get`, `reports_create`, `reports_update` |
| Default access | role `user`: Ask through Baxter + Chat directly                                                                                  |

Defined in `src/lib/agents/defaults.ts` (`DEXTER_DEFAULT_CONFIG`) and seeded by
`src/lib/agents/seed.ts`. Like every agent, the published configuration is versioned and
editable in AI Studio (instructions, model, examples, keywords, limits, tools, access).

Tool behavior (`src/lib/agents/report-tools.ts`):

- All tools re-derive the **requester's** Reports access on every call; Dexter can never see
  more than the person he's helping.
- `reports_list_fields` returns fields the requester may use with fill rates and sample
  values, plus business terms and whether each is mapped (and why not).
- `reports_preview` / `reports_aggregate` run real calculations on the cache for answering
  questions without saving.
- `reports_create` validates the spec, checks every field exists and is visible, dry-runs it,
  and saves a **private** report owned by the requester. Unknown or unmapped fields fail with
  the specific reason, so Dexter must say the data isn't available instead of guessing.
- `reports_update` applies structured edit operations with optimistic concurrency
  (`expectedVersion`); it refuses when the requester can't edit, and blocks only problems the
  edit introduces (pre-existing gaps are reported).
- Tools are `draft` risk: in the AI Studio sandbox they don't save.
- Saved reports come back as platform-verified **artifacts**; artifacts the model writes into
  its answer are discarded.

## 10. Delegation architecture

```
Slack / web chat → Baxter answer pipeline → maybeDelegateBaxterRequest()
   1. explicit mention ("ask Dexter …", "have Dexter …")          → Dexter
   2. rules: keywords + similarity to positive/negative examples   → clear match or no match
   3. borderline → small AI routing call with each specialist's capability card
   → authorization (unverified Slack users and users without "Ask through Baxter" are refused)
   → task (ai_tasks) with recent conversation turns as data → Dexter runs → Baxter replies
     with Dexter's summary and "Open the report …" links
```

- Reporting requests (reports, dashboards, charts, breakdowns, comparisons, "which projects…",
  "how many projects…") route to Dexter; HR/onboarding stays with **Sam**; general questions,
  single-project lookups, CRM, and Property Research stay with Baxter. The built-in routing
  regression suite (every specialist's examples) runs in unit tests and in AI Studio.
- Baxter's delegation guidelines were upgraded to describe Dexter only if they matched the
  shipped default (customized guidelines are untouched).
- Direct chat: the floating **Ask Dexter** panel on every report and **Create with Dexter**
  call `POST /api/reports/chat`, which runs Dexter directly (requires "Chat directly") with the
  current report id and the last turns of that report's conversation. Progress (tool steps) is
  polled from `/api/reports/chat/progress`.
- All Dexter work is recorded as tasks with events, tokens, and cost — visible in **Tasks**
  and **Mission Control**, and Dexter appears in the AI Office in the Business Intelligence
  room.
