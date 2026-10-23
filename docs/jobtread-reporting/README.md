# JobTread Reporting (Reports + Dexter)

Interactive, permission-aware reports built from Acton ADU's JobTread data, created and
edited by talking to **Dexter** (AI Reporting & Data Analytics Specialist), who reports to
Baxter. Reports live at **`/reports`**. Property Research moved to **`/property-research`**.

## Topics

| #   | Topic                                    | Where                                                                                         |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Architecture overview                    | [below](#1-architecture-overview)                                                             |
| 2   | JobTread API setup                       | [setup-and-deployment.md](setup-and-deployment.md#2-jobtread-api-setup)                       |
| 3   | Authentication and credential management | [setup-and-deployment.md](setup-and-deployment.md#3-authentication-and-credential-management) |
| 4   | Data model and mappings                  | [data.md](data.md#4-data-model-and-mappings)                                                  |
| 5   | Supported JobTread entities and fields   | [data.md](data.md#5-supported-jobtread-entities-and-fields)                                   |
| 6   | Synchronization behavior                 | [data.md](data.md#6-synchronization-behavior)                                                 |
| 7   | Report specification schema              | [reports.md](reports.md#7-report-specification-schema)                                        |
| 8   | Dashboard renderer                       | [reports.md](reports.md#8-dashboard-renderer)                                                 |
| 9   | Dexter agent configuration               | [dexter.md](dexter.md#9-dexter-agent-configuration)                                           |
| 10  | Delegation architecture                  | [dexter.md](dexter.md#10-delegation-architecture)                                             |
| 11  | Report security model                    | [security.md](security.md)                                                                    |
| 12  | Admin user guide                         | [guides.md](guides.md#12-admin-user-guide)                                                    |
| 13  | End-user reporting guide                 | [guides.md](guides.md#13-end-user-reporting-guide)                                            |
| 14  | Creating reports conversationally        | [guides.md](guides.md#14-creating-reports-conversationally)                                   |
| 15  | Editing reports conversationally         | [guides.md](guides.md#15-editing-reports-conversationally)                                    |
| 16  | Testing and verification                 | [testing.md](testing.md)                                                                      |
| 17  | Deployment guide                         | [setup-and-deployment.md](setup-and-deployment.md#17-deployment-guide)                        |
| 18  | Known limitations                        | [limitations-and-roadmap.md](limitations-and-roadmap.md#18-known-limitations)                 |
| 19  | Future enhancements                      | [limitations-and-roadmap.md](limitations-and-roadmap.md#19-future-enhancements)               |

## 1. Architecture overview

```
 JobTread Pave API (read-only)
        │  POST https://api.jobtread.com/pave   (grant key server-side only)
        ▼
 src/lib/jobtread/          client.ts   read-only guard, retries, 413 page halving
                            metadata.ts custom-field discovery, access categories, business vocabulary
                            sync.ts     full reconciliation → jt_* cache tables (Supabase)
                            detail.ts   live per-job milestones + file names (5-min cache)
        ▼
 Supabase cache             jt_connection, jt_sync_runs, jt_custom_fields,
                            jt_semantic_fields, jt_jobs, jt_catalog_models
        ▼
 src/lib/reports/           spec.ts     report definition schema (configuration, never code)
                            fields.ts   field catalog (built-ins + custom fields + sem: vocabulary)
                            compute.ts  deterministic calculations (pure functions)
                            engine.ts   executes a spec for one viewer's data access
                            ops.ts      structured edits used by Dexter
                            repo.ts     saved reports, versions, shares, pins, chat
        ▼
 /api/reports/*             authorized route handlers (every call re-checks access)
        ▼
 /reports UI                hub · report view/editor · Create with Dexter · Data settings
 src/components/report-builder/   widgets (Recharts, TanStack Table), filters, drawers, Dexter chat

 Dexter (AI Workforce specialist) ── report tools (src/lib/agents/report-tools.ts)
        ▲                               reports_list_fields / preview / aggregate / list / get / create / update
        │ delegation (rules → AI router)
 Baxter (AI CEO) ── Slack, web chat
```

Key design decisions:

- **Reports store definitions, not data.** Every view re-executes the definition with the
  viewer's own access, so sharing a report never shares restricted values.
- **The AI never produces code or numbers.** Dexter writes a validated JSON spec (or
  structured edit operations). Trusted React components render it; `compute.ts` produces
  every number. Values the model claims are discarded — saved-report links in replies come
  only from tool results (`artifacts`).
- **Business vocabulary over raw ids.** Reports reference `sem:phase`, `sem:project_manager`,
  etc. Admins map each term to a JobTread custom-field id, so renaming a field in JobTread
  doesn't break reports.
- **Cache + live hybrid.** Lists, KPIs, and charts read the synced cache (one sync ≈ 22 API
  calls / ~3 s for Acton today). Project pages (Design Handoff) fetch milestones and file
  names live.
