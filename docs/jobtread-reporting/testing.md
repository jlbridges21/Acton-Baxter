# 16. Testing and verification

Run everything the project requires before shipping:

```bash
npm run format && npm run lint && npm run typecheck && npm run test && npm run build
```

Reports-specific suites (synthetic data only — `src/lib/jobtread/fixture.ts`):

| File                                      | Covers                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/jobtread-integration.test.ts` | Read-only guard (incl. aliases), key never in errors/results, 401/429/5xx handling, cursor paging with 413 halving, field categories, multi-value fields, full sync + soft removal, sticky admin mappings, failed-grant runs, opt-in schedule, live job detail                                                                                                                                                                    |
| `tests/unit/reports-engine.test.ts`       | Calculations (blanks, medians, float noise, Other bucket, sort), CSV injection guard, spec validation (no executable content), structured edits, template execution, filters/search, restricted financial/customer/internal fields, multi-value grouping, missing/unmapped fields, skipped table columns, Design Handoff live detail, drilldowns                                                                                  |
| `tests/unit/reports-dexter.test.ts`       | Dexter registration (department, manager, tools), routing (Dexter vs Sam vs Baxter), report permissions and sharing, templates, versions/conflicts/restore, pins, Dexter create/edit via tools with a scripted model, refusal on unavailable fields, view-only edit refusal, prompt-injection-as-data, Mission Control tasks                                                                                                      |
| `tests/unit/dexter-intelligence.test.ts`  | Document financials; commission math (rates per person, project overrides, historical rates, splits, missing GP/rate/date, losses, zero/null, reproducibility); rule versioning + audit; entity catalog verification; feasibility verdicts & suggestions; planning memory; attachment validation and vision success/failure; commission dashboard permissions; the full multi-turn commission conversation; Dexter config upgrade |
| `tests/unit/agents-config.test.ts`        | Routing regression across all specialists (negative examples mean "not this agent")                                                                                                                                                                                                                                                                                                                                               |
| `tests/e2e/reports.spec.ts`               | Hub + templates, live KPI recalculation on filters, provenance, copy → edit → undo/redo → save → history, financial restriction for standard users, Dexter panel, `/dashboard` redirect                                                                                                                                                                                                                                           |

E2E runs with `JOBTREAD_E2E_FIXTURE=true` and a fake grant key (see `playwright.config.ts`),
so it never calls JobTread or Anthropic.

## Manual validation (after deploying with a real grant)

1. Data settings → Test connection → "Connected · Acton ADU"; Sync now → ~447 jobs.
2. Active Projects template: active count should equal the number of jobs in JobTread whose
   Phase is a BR-/Custom- Estimating/Design/Permitting/Production value (33 on 2026-10-22).
   Click "In design" → the drawer lists the same jobs JobTread shows.
3. Product Library: as an admin, the i 398 row shows $263,301 cost / $368,621 price; as a
   standard user, those columns are hidden.
4. Design Handoff: pick a project in design; compare model, site, and utility values with the
   job's custom fields in JobTread; milestones match the schedule groups.
5. Create with Dexter: "Make a chart of active projects by project manager" → a private report
   opens; ask "make it a bar chart" → version 2; History → restore version 1.
6. In Slack, ask Baxter "Have Dexter show how many projects are in each phase" → reply includes
   an "Open the report" link (requires a mapped Slack account).
7. Share a report with a colleague who lacks financial access → their view hides financial
   widgets.
