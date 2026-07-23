# Adding California jurisdiction connectors

1. Create `src/lib/connectors/california/<jurisdiction>/`
2. Add `config.ts` with ArcGIS layer URLs and field maps
3. Add normalizers that return parcel/zoning/overlays without throwing on single-layer failure
4. Register in `src/lib/connectors/california/registry.ts`
5. Seed a `jurisdiction_connectors` row in a new migration if needed
6. Add unit tests with mocked ArcGIS responses
7. Document field priorities in `docs/source-priority.md`

Do not scrape browser apps. Prefer public FeatureServer/MapServer query endpoints.
