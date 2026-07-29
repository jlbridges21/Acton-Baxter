# Baxter PEM NEAT retrieval

Completed PEM NEATs are a **first-class Baxter evidence source**. They are not dumped into Knowledge Base Markdown.

## Pipeline

```
User question
  → PEM intent (help/definition vs record lookup)
  → prospect entity resolution (name / partial / conversation inherit)
  → authorize (user | admin | super_admin; Slack allowlist; never new_user)
  → load latest completed current generation (skip failed/generating/deleted)
  → field-aware structured excerpt
  → merge with KB / GHL / Rulebook evidence
  → reason + cite
```

Shared entry point: `answerBaxterQuestion()` (web + Slack).

## Code

| Module   | Path                                                               |
| -------- | ------------------------------------------------------------------ |
| Intent   | `src/lib/baxter-data/pem-neats/intent.ts`                          |
| Evidence | `src/lib/baxter-data/pem-neats/evidence.ts`                        |
| Store    | `src/lib/pem-neat/store.ts` (relational `pem_neats` / generations) |

## Intent split

- **Help / definition**: “What is a PEM?”, “What is a PEM NEAT?”, “How do I generate one?” → capability/docs answers (`pemHelpDefinitionAnswer` + capability registry). No prospect lookup.
- **Record lookup**: “What was Robert’s Type 1 pain?” → structured NEAT fields for that prospect.

## Entity resolution

- Match prospect name (case-insensitive, partial, surname)
- Inherit from conversation history for “his budget” follow-ups
- Ambiguous people → clarify (do not merge)
- Multiple PEMs for one prospect → prefer latest completed; allow “first” / date hints
- Stale / needs regeneration → warn; deleted → excluded

## Field-aware retrieval

Only requested areas are loaded into context (Type 1, budget, assessment, BuilderTrend handoff, etc.). Full transcript is **not** the default source.

## Citations

- Source kind: `pem_neat`
- Label: `{Prospect} — PEM NEAT — {Meeting date}`
- URL: `/pem-neats/{id}` (absolute via `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL` for Slack)

## Authority

| Question                                    | Authority                              |
| ------------------------------------------- | -------------------------------------- |
| Type 1 / budget / assessment from a meeting | Completed PEM NEAT                     |
| Current CRM stage                           | Live GoHighLevel                       |
| What is Type 1 Pain?                        | Acton PEM docs / capability help       |
| What can Baxter do?                         | Capability registry + connector health |

## Privacy

Authorization runs **before** evidence reaches the model. Q&A never mutates the saved NEAT.
