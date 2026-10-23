# Adding a provider

Example: making **surveys** searchable.

1. **Decide the indexing strategy.**
   - The list is small and in memory: `registry`.
   - Baxter owns the records, queries are cheap, and permissions are complex: `live`.
   - Baxter owns the records, there are many, and you want typo tolerance at scale: `index`.
   - The records are external personal data (CRM, HR): `live` only. Never index them.

2. **Create `src/lib/search/providers/surveys.ts`:**

   ```ts
   import "server-only";
   import type { SearchProvider } from "../provider";
   import { safeId } from "../safety";

   export const surveysProvider: SearchProvider = {
     id: "surveys",
     category: "tools", // or add a category in types.ts (SEARCH_CATEGORIES)
     name: "Surveys",
     icon: "clipboard-list",
     sourceSystem: "baxter",
     description: "Surveys by title.",
     searchableFields: [
       { key: "title", label: "Title", sensitivity: "standard", defaultEnabled: true },
       { key: "responses", label: "Responses", sensitivity: "restricted", defaultEnabled: false },
     ],
     optional: true,
     indexing: "live",
     permissionSummary: "Same rule as the Surveys page.",
     minQueryLength: 2,
     timeoutMs: 2000,
     async canUse(ctx) {
       return ctx.user.role !== "new_user";
     },
     async availability() {
       return { available: true };
     },
     async search(ctx) {
       const surveys = await listSurveysVisibleTo(ctx.user.id); // reuse the page's own rule
       return {
         hits: surveys.flatMap((s) => {
           const id = safeId(s.id, /^[0-9a-f-]{36}$/i);
           return id
             ? [
                 {
                   recordId: id,
                   title: s.title,
                   url: `/surveys/${id}`,
                   auth: "record" as const,
                   match: { title: s.title },
                 },
               ]
             : [];
         }),
         freshness: { kind: "live" },
       };
     },
     async lookup(ctx, ids) {
       /* same as search, filtered to ids */ return [];
     },
   };
   ```

3. **Register it** in `src/lib/search/registry.ts` (`PROVIDERS`).

4. **For `index` providers,** add `indexer: { refreshMinutes, fetchAll }` and set
   `search: (ctx, input) => indexedSearch(provider, ctx, input)`. `fetchAll` returns
   `IndexDoc`s with only approved fields in `searchText` and an ACL: `aclRoles`, `aclUsers`,
   or `aclCapabilities`. `lookup` must re-read the source and re-check permission. That
   re-check is what keeps deleted and newly restricted records out.

5. **Tests:** add cases to `tests/unit/global-search-providers.test.ts`:
   - The provider finds a new record with no code change.
   - It never returns a record the viewer can't open.
   - Restricted fields don't match.
   - It reports `unavailable` when its source is down.

6. **Docs:** add a row to the tables in `providers.md` and `authorization.md`.

The provider then appears on `/admin/search` with its fields, availability, and latency.
