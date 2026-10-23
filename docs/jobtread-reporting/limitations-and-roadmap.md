# Limitations and roadmap

## 18. Known limitations

- **Design hours:** JobTread has no time entries for Acton yet, so design-hours reports can't
  be built. Dexter says so.
- **Product specifications** from the Domo Product Library (bedrooms, bathrooms, dimensions,
  appliances, alternate pricing) are not in JobTread. Only 2 of 77 models have budgets
  imported; the rest show "Pending import" with blank prices.
- **Unmapped business terms:** Vault Height, Floorplan, Approved Site Plan, and Soil/Utility
  Notes have no JobTread custom field (plans are stored as job files). They show "not
  available" in Design Handoff until an admin maps a field.
- **Status field:** JobTread "Status" is nearly always blank; active work is defined by Phase.
- **Freshness:** lists and charts reflect the last sync (hourly by default when enabled);
  project pages are live within 5 minutes.
- **Files:** names and folders only — links open the job in JobTread rather than the file.
- **Data scope:** jobs (with job/location/customer fields), catalog models, and financial
  document totals (orders, invoices). Cost items, tasks (except live per project), daily logs,
  contacts, and vendors are verified in the catalog but not synced.
- **Grant:** the current grant has no JobTread-side restrictions (Baxter enforces read-only in
  code). It expires after 3 months without use.
- **Chat:** one conversation per user per report; Dexter requests run inline (up to ~260 s)
  rather than in the background.
- **Tables** show the first 1,000 matching rows (CSV export of a table matches what's shown).
- **Commissions:** gross profit is projected (customer orders; most are drafts), not realized;
  payment dates must be entered in Baxter because JobTread has no payments; Connor has no jobs in
  JobTread's Sales Rep field. Tiered rates and partial-payment rules aren't implemented yet.
- **Attachments:** images over 5 MB, scanned PDFs without a text layer, and DOCX layout aren't
  analyzed visually.

## 19. Future enhancements

- A read-only JobTread grant (restricted actions) and grant-expiry reminders in Slack.
- Import the Domo Product Library specs (or add catalog custom fields in JobTread) so model
  comparisons include beds/baths/dimensions; finish budget imports for all models.
- Time tracking in JobTread → design-hours and utilization reports.
- Cost items, budgets vs actuals, invoices/payments (financial category) and daily logs.
- Scheduled report digests to Slack/email and threshold alerts ("permits waiting > 30 days").
- Field-level change history (phase durations, time in permitting).
- Webhook-driven incremental sync if JobTread exposes change events.
- Per-viewer saved filter presets and dashboard tabs.
- Sync payments and cost items once Acton records them in JobTread; then add realized gross
  profit and payment-triggered commissions.
- Tiered and split-by-milestone commission rules; payroll export (with approval).
