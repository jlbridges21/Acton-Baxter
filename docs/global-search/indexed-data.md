# Indexed data

`global_search_index` (migration 074) stores **candidate-generation data only** for
Baxter-internal and already-synced records. The owning provider re-reads every candidate
from its source table and re-checks permission before returning it.

| Provider             | Stored in `title` / `subtitle` | Stored in `search_text`                                                                                                                                                                    | Identifiers             | ACL                                                                              |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `jobtread-jobs`      | Job name / customer name       | Customer, location name, formatted address, values of **general-category** custom fields mapped through Reports semantic fields (Phase, Status, PM, Model, Job Type, Sales Rep by default) | Job number, JobTread id | `aclCapabilities: ["reports:general"]`                                           |
| `knowledge`          | Title / category               | Category, tags, source name (if enabled), summary (≤ 400 chars), article text (≤ 3,000 chars, if enabled). The row carries the entry's ACL, so body text only reaches readers.             | —                       | Approved+internal: everyone. Draft: author (admins pass). Otherwise: admin roles |
| `inventory`          | Item name / vendor             | Project, category, status, storage, description and notes (≤ 300 chars each). **Never costs.**                                                                                             | SKU, order number       | Any approved role                                                                |
| `inspections`        | Project name / template name   | Address, status, job (expense job label), inspector, creator, item notes (≤ 2,000 chars, if enabled). Never media or transcripts.                                                          | Project number          | Any approved role                                                                |
| `jobtread-documents` | Document name / type           | Status, job name and number, customer. **Never prices, costs, or line items.**                                                                                                             | Document number, id     | `aclCapabilities: ["reports:financial"]`                                         |

## Never indexed

- GoHighLevel contacts, opportunities, conversations, or custom fields (live only).
- BambooHR anything (live only, HR-scoped).
- Report data. Reports are searched by metadata, live through the Reports repo.
- Agent instructions or configuration (searched live from the registry: card fields only).
- AI task instructions and results.
- JobTread financial fields (prices, costs, margins), internal sales notes, and
  customer-category custom fields. Customer-category values are matched only after the
  per-viewer re-read, for viewers with Customer details access.
- Inventory costs, inspection media and transcripts, JobTread document amounts and line items.

When the index isn't installed (migration 074 not applied), the same documents are built
from the source on demand and held in memory for 60 seconds instead; the ACL rules and the
`lookup()` re-read are identical.

## Columns

`provider`, `record_id` (unique together), `category`, `title`, `subtitle`, `search_text`
(normalized `[a-z0-9 ]`), `identifiers[]`, `address_norm`, `url`, `acl_roles[]`,
`acl_users[]`, `acl_capabilities[]`, `record_updated_at`, `indexed_at`, `updated_at`, and the
generated `fts` (`to_tsvector('simple', …)`).

Indexes: unique `(provider, record_id)`, `(provider, indexed_at)`, GIN on `fts`, GIN on
`identifiers`, and GIN trigram (`pg_trgm`) on `search_text` and `address_norm`.
