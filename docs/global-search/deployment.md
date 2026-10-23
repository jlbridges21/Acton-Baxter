# Deployment

Nothing in this change has been applied to production or deployed.

## 1. Migration

Apply `supabase/migrations/074_global_search.sql` after 071, 072, and 073. It is additive and
creates:

- the `pg_trgm` extension, in the `extensions` schema when it exists (Supabase), otherwise
  the default schema;
- `global_search_index`, `global_search_providers`, `global_search_synonyms`, and
  `global_search_recents`, all with RLS enabled and no policies (service role only);
- trigram, full-text, and identifier indexes;
- `public.global_search_query(...)`, executable by `service_role` only.

Search works before the migration in memory mode (tests and E2E). In Supabase mode, indexed
providers report an error status until the migration is applied, and live and registry
providers keep working.

## 2. Environment variables

No new variables. Global Search reads the existing ones (names only):

| Variable                                                                                 | Used for                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Sessions and the index tables                                      |
| `BAXTER_CHAT_ENABLED`                                                                    | Whether "Ask Baxter" is offered                                    |
| `GHL_ENABLED` and the existing GoHighLevel credential variables                          | GoHighLevel providers' availability                                |
| `JOBTREAD_GRANT_KEY`, `JOBTREAD_ORGANIZATION_ID`                                         | JobTread provider availability (data comes from the existing sync) |
| `BAMBOOHR_COMPANY_DOMAIN` and the existing BambooHR OAuth variables                      | BambooHR availability and access                                   |
| `BAXTER_CRON_SECRET`                                                                     | The existing cron route that now also refreshes the index          |
| `E2E_TEST_AUTH_BYPASS`, `JOBTREAD_E2E_FIXTURE`                                           | Tests only (refused in production)                                 |

## 3. Rollout

1. Apply migration 074 to staging. Confirm `select public.global_search_query('test','test','test','test',array['inventory'],'admin','00000000-0000-0000-0000-000000000000',array['admin'],5);`
   runs as the service role.
2. Deploy to a preview. Sign in as an admin and open `/admin/search`, then click
   **Reindex all**. Check the counts and that the timings are reasonable.
3. Run **Test a query** for a known job number, a customer name, and part of an address.
4. Sign in as a standard employee. Confirm that admin pages, other people's private reports,
   knowledge drafts, and (unless you are HR) BambooHR employees don't appear.
5. Promote to production and apply the migration there.
6. Watch `/admin/search` performance and the `[search.*]` server log lines for the first day.

## Rollback

The feature is additive. To hide it, revert the `GlobalSearch` button in
`src/components/layout/app-nav.tsx`. The API routes are harmless without the UI. The tables
can stay, or be dropped with `drop table global_search_*` and
`drop function global_search_query`.
