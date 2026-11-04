# Configurator — delivery report (2026-11-04)

Setup, DNS cutover and rollback: [README.md](README.md).

## What was built

- **Customer configurator** at `/design`. It reproduces design.actonadu.com: full-screen scroll-snapped steps, 70/30 rendering/panel layout, blurred backdrop, the same card styles, toggles, price card and copy, the Floorplan and Mirror toggles, Style details, the Pre-approved badge, mobile stacking, and the three GHL forms. Step order is Model → Model Options (only when the model has options) → Exterior → Interior → Appliances → Upgrades → Bathroom → Free Quote.
- **Admin workspace** at `/configurator` (admin-only, under Baxter → Tools):
  - dashboard and model library with readiness meters
  - model workspace with tabs for Overview, Model Options, Exteriors, Interiors, Appliances, Upgrades, Bathrooms, Pricing, Images and Preview
  - per-style editor with images by porch/ceiling and Pricing by Region
  - bulk pricing grid with keyboard, spreadsheet paste, $/% adjustments, copy between regions and mark-reviewed
  - city-based regions
  - shared style library
  - media library and import report
  - guided "Add model" wizard
  - duplicate model
  - publish with version history and restore
  - settings
- **Data:** migration `086`, plus an importer that rebuilt the catalog from the Models folder and the live site's public catalog/quote APIs.

## Import results (local run)

| Model               | Folder     | Renderings in place |
| ------------------- | ---------- | ------------------- |
| Manzanita i448 A1   | i-448-A2 ⚠ | 91 / 92             |
| Juniper i628 A1     | i-628-A-1  | 83 / 92             |
| Buckeye i748 A1     | i-748-A-1  | 67 / 92             |
| Ironwood i888 B1    | i-888-B-1  | 67 / 92             |
| Bristlecone i998 A1 | i-998-A-1  | 74 / 92             |
| Nutmeg s498 A1      | S-498-A-1  | 68 / 68             |
| Santa Lucia s658 A1 | S-658-A-1  | 68 / 68             |
| Cypress s748 B1     | S-748-B-1  | 68 / 76             |
| Redwood s1198 A1    | S-1198-A-1 | 60 / 68             |

The importer registered **783 images**:

- all 776 local files
- 128 from the live site, all with provenance: bathroom renderings (none are in the folder) and the Style details boards

That covers **10 shared exterior styles and 8 shared interior styles**.

**Missing renderings (94).** None were invented. The gaps are:

- **9-ft Santa Barbara Spanish exterior:** missing for every Investor model.
- **Bristlecone:** has no 9-ft exteriors and no 9-ft Kitchen renderings.
- **Lighting Dusk Uplights (8-ft):** missing for Buckeye, Ironwood, Juniper, Cypress and Redwood. Those folders have only "Lighting Dusk", which must not be used for the lighting upgrade.
- **Lighting Daytime:** missing for Buckeye and Ironwood at 8-ft and 9-ft.

**Uncertain mappings to confirm (all shown in Media & Import):**

- The folder `i-448-A2` was mapped to Manzanita i448 A1. Its files are labelled A-1, A-2 and A-12.
- Three file-name typos were matched to the intended styles: "Urban Minimalsm", "Classic Elegancel" and "Vila Noir".
- Cypress interior files carry extra "(O-1) (GS)" tags.
- Juniper has two Appliance Base files for Urban Minimalism. The first one was kept.

**Live-site problems found and not copied:**

- Cypress "Standard / Santa Barbara Spanish" shows an Investor i748 image, priced $0. The porch price of $19,500 was imported.
- Ironwood's Hacienda Retreat has its appliance prices swapped.
- Some bathrooms are listed but have no price. These became $0 placeholders that need review.

**Prices:**

- 235 prices were imported from the live site's quote API for the Bay Area. All are marked **needs review**, so nothing publishes until someone reviews them.
- The rebuild reproduces the live totals exactly. Nutmeg in San Jose is **$396,500 / $2,377 a month**, then **$403,200 / $2,417** with porch, then **$404,700 / $2,426** with lighting. These match the screenshots.

**Region:**

- The live site prices 257 ZIP codes identically, which makes it one region.
- These became **"Bay Area" with 123 USPS cities**.
- Review San Francisco: only 5 of its ZIP codes were priced on the live site, but it is now included in full.
- Milpitas was never priced, so it is not included.

## Verification

| Check                                     | Result                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests, configurator (rules + routes) | 46/46 pass                                                                                                                                                                                                                                                          |
| Full unit suite                           | Configurator and navigation tests pass. 47 failures in 7 unrelated files (inventory-ui, site-inspection, dashboard-tools, project-status-filter, new-project timing) fail the same way with these changes removed (`localStorage` in jsdom); they are pre-existing. |
| E2E `tests/e2e/configurator.spec.ts`      | 7/7 pass: admin access, dashboard + style editor, publish, gated pricing with exact live-site totals, porch / 9-ft / lighting / appliance renderings, floorplan + mirror, legacy deep links, outside-area, mobile                                                   |
| `npm run build`                           | Passes; no configurator trace warnings                                                                                                                                                                                                                              |
| Price gate                                | No price strings in the HTML or the public API before a location is set. A forged token is refused. Previewing as a non-admin is refused.                                                                                                                           |
| Access                                    | Non-admins get 403 on admin APIs and are redirected away from `/configurator`.                                                                                                                                                                                      |

## Needs a person / outside this build

1. **Apply migration 086**, then run the importer with `--target=supabase`. Neither has been run against production.
2. **Review prices** and fill the missing renderings, or knowingly allow the 8-ft fallback. Then publish.
3. **GHL:** submit one approved test lead per form on the staging URL. Only after confirming how sales uses the `cfg_*` fields, decide whether to set `CONFIGURATOR_GHL_SYNC=true`. No real form was submitted during this build.
4. **Can I Build:** confirm with them that `data-design-name` restricts results to the selected plan, and that the staging host is allowed for the widget token.
5. **Financing:** confirm the 6% / 30-year assumption. It matches the live numbers, but the source of that rate is not documented.
6. **Legacy admin:** it was not accessed. Assistants must not enter passwords. Consider rotating that shared password, since it was shared in chat.
