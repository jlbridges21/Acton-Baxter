# Adding California jurisdiction connectors

1. Create `src/lib/connectors/california/<jurisdiction>/`
2. Add `config.ts` with ArcGIS layer URLs and field maps (`key` must be stable, e.g. `ca-…`)
3. Add normalizers that return parcel/zoning/overlays without throwing on single-layer failure
4. Register in `src/lib/connectors/california/registry.ts`
5. Seed a `jurisdiction_connectors` row in a new migration if needed
6. Add the same `key` to `SUPPORTED_JURISDICTIONS` in `src/lib/jurisdictions/keys.ts` so admin tagging, structured rules, report ADU Code Highlights, and chat filtering recognize it
7. Add unit tests with mocked ArcGIS responses
8. Document field priorities in `docs/source-priority.md`

Do not scrape browser apps. Prefer public FeatureServer/MapServer query endpoints.

## Building-code / ADU rules for a new jurisdiction

After the connector is live:

1. Upload municipal-code PDFs via `/admin/knowledge/upload` (set **Jurisdiction** + **Document kind**), or associate existing Knowledge entries at `/admin/jurisdictions`
2. Enter structured rules in `/admin/jurisdictions` with **required** source citations (e.g. municipal code section). Use catalog rule keys (`fire_sprinkler_hydrant_distance_max_ft`, `adu_setback_*_ft`, …) or a new snake_case key
3. Optional `zone_key` on a rule scopes it to a zoning designation; reports prefer zone-specific rules when the property’s zoning matches, otherwise jurisdiction-general rules

Reports always render an **ADU code highlights** section for the resolved jurisdiction (honest empty state when nothing is configured). Chat filters other jurisdictions’ code docs and injects structured rules when the question looks like a building-code inquiry.
