# External sources

All external access is read-only, goes through existing connectors, and never writes to
GoHighLevel, JobTread, or BambooHR.

## GoHighLevel (live)

- **Contacts:** `searchContacts` (`POST /contacts/search`, API v3, `pageLimit`) with `query`
  for names, emails, and phones. Address-like queries ("123 Main Street") use the
  connector's documented address filter (`address1` / `postalCode` `contains`) with the house
  number and first street word, because GoHighLevel's `contains` is literal. Results are
  then ranked locally with normalized addresses.
- **Opportunities:** `searchOpportunities` (`GET /opportunities/search`, `q`, `limit`, `page`).
- **Lookup (recents):** `getContactsByIds` (one `GET /contacts/{id}` per id, at most 10).
- **Links:** only ids GoHighLevel returned, into Baxter's own Customer Center
  (`/customers/lookup?contactId=…`). Admins also get the connector's contact and opportunity
  pages. No GoHighLevel web URLs are constructed.
- **Fields:** name, email, phone, company, and address (admin-selectable). Custom fields,
  notes, conversations, and monetary values are restricted.
- **Unavailable** when `GHL_ENABLED` is off or credentials are missing. The modal then says
  "GoHighLevel isn't connected" instead of claiming there are no results.
- **Limits:** 40 searches per user per minute per GoHighLevel provider; 3.5 s timeout.

## JobTread (cached)

- Search never calls JobTread. It reads Baxter's `jt_jobs` cache, which the existing Reports
  sync fills (`runFullSync`, on its own schedule from `/api/internal/process-jobs`).
- Results carry `freshness: cached` with the row's own `synced_at`, displayed as
  "JobTread · Last synced 12 min ago".
- The primary link and the "View JobTread source" action use `https://app.jobtread.com/jobs/{id}`
  (the same URL `jobTreadJobUrl` already produces). They open in a new tab.
- If JobTread isn't configured, the provider is unavailable and its index rows are purged on
  the next refresh.

## BambooHR (live, HR-scoped)

- `listEmployees` (`GET /v1/employees`) with BambooHR's name filter (last name, then first
  name). Multi-word queries send the last word and rank the rest locally.
- Fields requested by the existing service: first name, last name, preferred name, job
  title, and status. Compensation, SSN, payroll, health, demographics, home address, and
  documents are never requested, searched, or displayed.
- Only the CEO, COO, and confirmed HR administrators (`BambooAccess.canViewAll`) can use
  it. For everyone else the provider and the Employees category don't exist.
- Every search writes an audit row (`search.bamboohr`) with the result count and query
  length, never the contents.
- No recents are stored for employees: there is no `lookup`, by design.
- Unavailable unless the connection status is `connected`.
