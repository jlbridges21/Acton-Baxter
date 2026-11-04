# Asset Import and Rendering Selection Rules

## Local source
Baxter project root: `Models/Investor Series/<model>/...` and `Models/Signature Series/<model>/...`. These contain folders/images, **not authoritative prices or metadata**. File naming may differ from display names (e.g., `I4-48 A2` may refer to Manzanita; verify from assets and site rather than assume IDs).

## Explicit known interior structure
Inside a model's `Interior/` folder are `8-foot/` and `9-foot/` contexts. Each shared interior style has seven renderings for each ceiling-height context:

| Asset role | Customer context |
|---|---|
| `Kitchen` | First rendering when Interior Style is selected |
| `Lighting Daytime` | Additional/normal interior style view |
| `Appliance Base` | Lifestyle appliance selection |
| `Appliance Mid` | Premium appliance selection |
| `Lighting Dusk Uplights` | **Lighting Upgrade** rendering; specifically shows over-cabinet lighting |
| `Lighting Dusk` | Not the chosen image for lighting upgrade |
| `Ambiance` | Not currently used in customer flow |

Every interior style has its own set of seven renderings in **both** height folders, according to user; validate actual directory structure. If discovered layout differs, adapt importer and flag missing/ambiguous variants.

## Cross-step dependencies
- A 9-foot ceiling choice must change **interior and exterior** contexts, including when revisiting a previous step; base 8-foot choices must restore 8-foot renders.
- Ceiling height does **not** require a change in appliance or bathroom image variants, according to user.
- Exterior image may depend on chosen model + exterior style + ceiling height + `Standard` vs `With Porch` (on applicable models).
- Interior style selects kitchen image. Later appliance choice maps to relevant `Appliance Base`/`Appliance Mid` of the selected interior style. Lighting upgrade selects `Lighting Dusk Uplights` of the same interior/height context.
- No need to display `Ambiance` by default. `Lighting Dusk` is distinct from `Lighting Dusk Uplights` and **must not** be used accidentally for upgrade.
- Existing live frontend is the reference for the exact viewport/fit, first/second views, lighting toggles and effects that screenshots alone cannot reveal.

## Importer and editor behavior
1. Crawl folders/files safely and generate a preview inventory by series/model/asset type/style/height/porch/view.
2. Suggest mapping using filename/folder evidence, known aliases and current site metadata. No invented matches.
3. Present ambiguous matches for manual admin review with side-by-side images. Preserve provenance/path metadata.
4. Establish rendering keys/contexts instead of relying on position in filenames; admins can replace or upload by drag/drop.
5. Show coverage matrix per model (required combinations and available images). Prevent broken public images; preview and publish validation should identify specific missing selections.
6. Support optional unused assets in media library without forcing them into customer steps.
7. Floorplans are distinct from exterior/interior renders and should preserve current floorplan/mirror behavior where applicable.

## Representative manual QA paths
- Investor Manzanita: Model → Exterior (no Model Options) → Interior → Lifestyle appliance → Lighting Upgrade → Bathroom; 8ft↔9ft should swap exterior and interior appropriately.
- Signature Cypress: Model → Standard vs With Porch → Exterior → Interior → Appliance → Upgrade → Bathroom; changing porch changes exterior image while respecting exterior style.
- On changing model, preserve shared style choices when available, reset unsupported option, update every render and total.
