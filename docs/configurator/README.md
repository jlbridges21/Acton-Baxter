# Acton ADU Configurator

The customer configurator (a rebuild of design.actonadu.com) and its admin workspace, inside Baxter.

|                       | URL                                               | Who                                     |
| --------------------- | ------------------------------------------------- | --------------------------------------- |
| Admin workspace       | `/configurator` (Baxter → Tools → Configurator)   | Baxter admins / super admins only       |
| Customer configurator | `/design`                                         | Public, no login                        |
| Draft preview         | `/design?preview=draft`                           | Admins only; customers never see drafts |
| After DNS cutover     | `https://design.actonadu.com/` → serves `/design` | Public                                  |

The existing design.actonadu.com is untouched until DNS is pointed at Baxter.

## How it works

- **One draft, immutable releases.** Admins edit one draft catalog (models, shared styles, regions, prices, image assignments). **Publish** freezes a copy as a numbered release; the public page only ever reads the latest release. Restoring an older version re-publishes it as a new version, so history stays linear and the draft is never touched.
- **Per-model publishing safety.** A model with blocking problems (missing renderings, unreviewed or missing prices, $0 starting price) keeps its previously published version, or stays off the live site if it was never published. One unfinished model never blocks the others.
- **Prices are never in the page before location.** The public catalog has every price stripped. `/api/public/configurator/location` resolves the property's **city** to a region and returns a signed token; `/api/public/configurator/quote` returns one model's prices only for a valid token. ZIP codes are used only to look up USPS city names when the city is missing.
- **Rendering rules live in one place** (`src/lib/configurator/render.ts`): porch → exterior variant; 9-ft upgrade → 9-ft exterior and interior renderings on every step; Interior Style → Kitchen; appliance package → Appliance Base / Mid; Lighting Upgrade → Lighting Dusk Uplights (never Lighting Dusk); ceiling height never changes appliance or bathroom renderings. A missing rendering is never silently replaced; an admin may explicitly allow "use the 8-ft image when a 9-ft one is missing" per model.
- **Single source for prices.** The style editor's _Pricing by Region_, the model _Pricing_ tab and the bulk _Pricing_ grid all edit the same value. Each price is either a price per region or a base price plus per-region $/% adjustments.

Code map:

| Area                | Path                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Domain rules (pure) | `src/lib/configurator/{types,render,pricing,selection,regions,validate,catalog-ops,defaults}.ts` |
| Persistence         | `src/lib/configurator/store.ts`, `asset-storage.ts`, `supabase/migrations/086_configurator.sql`  |
| Admin UI            | `src/app/configurator/**`, `src/components/configurator/admin/**`                                |
| Customer UI         | `src/app/design/**`, `src/components/configurator/public/**`                                     |
| APIs                | `src/app/api/admin/configurator/**` (admin), `src/app/api/public/configurator/**` (public)       |
| Import              | `scripts/configurator-import.ts`                                                                 |
| Tests               | `tests/unit/configurator-*.test.ts`, `tests/e2e/configurator.spec.ts`                            |

## Production setup

1. **Apply the migration** `supabase/migrations/086_configurator.sql` in the Baxter Supabase SQL editor. It creates three admin-only tables and the public `configurator-assets` bucket (50 MB/file, JPEG/PNG/WEBP). Until it is applied, `/configurator` shows a setup notice and nothing else in Baxter changes.
2. **Import the existing catalog and renderings** from a machine that has the `ActonADU_Configurator/` folder:

   ```bash
   node_modules/.bin/jiti scripts/configurator-import.ts --target=supabase
   ```

   Uses `.env.local` Supabase keys, uploads web-sized renderings (≤2560 px JPEG + 480 px thumbnails, content-addressed so re-runs never duplicate) and writes the draft plus an import report. An existing draft is kept unless `--replace-draft` is passed. `--dry-run` only writes the report.

3. **Review in the admin.** Media & Import → Import report; Pricing (filter "Needs review only"); each model's Images tab. Mark prices reviewed (bulk "Mark reviewed" or per item), fill or explicitly accept missing renderings, then **Publish**.
4. **Optional env** (see `.env.example`): `CONFIGURATOR_GHL_SYNC`, `CONFIGURATOR_GTM_ID`, `CONFIGURATOR_PUBLIC_HOST`, `CONFIGURATOR_LOCATION_SECRET`.

## Local development and E2E

```bash
node_modules/.bin/jiti scripts/configurator-import.ts --target=local
```

writes `.configurator-local/seed.json` and processed images (gitignored). The in-memory store loads that seed whenever Baxter runs in mock/E2E mode (`E2E_TEST_AUTH_BYPASS=true`, or `CONFIGURATOR_LOCAL_MODE=true`). The `configurator-sandbox` entry in `.claude/launch.json` starts such a server on port 3300. `tests/e2e/configurator.spec.ts` uses the same seed and skips when it is absent.

## Integrations

**GoHighLevel** — the same three embedded forms as the live site, loaded with GHL's own `form_embed.js`:

| Form                       | ID                     | Where                                                   |
| -------------------------- | ---------------------- | ------------------------------------------------------- |
| Get in Touch / Free Quote  | `p1swLQWD4mVI7APiGzFp` | Last step; prefilled with the same query keys as before |
| "We'll need your location" | `pV3Gf1zaZHLuCTipKGKZ` | Clicking the blurred price                              |
| Save Design                | `1xhDrNtf1yDpbl6eS9gC` | Save button                                             |

Submissions go from the iframe straight to GHL, so workflows, consent, Turnstile and webhooks are unchanged. A submit is detected from the `set-sticky-contacts` message GHL posts to the page (the form's own City/State/Postal Code fields decide the pricing region). The legacy site also wrote `cfg_*` contact custom fields by creating a blank contact for every visitor; here those fields are written only to the contact that just submitted, only when `CONFIGURATOR_GHL_SYNC=true`. Values are now readable names (e.g. "Santa Barbara Spanish") instead of legacy internal codes — confirm with whoever uses those fields in GHL before enabling.

**Can I Build** — the Property Check popup embeds the existing search widget (same publishable token as the live site) and sets `data-design-name` to the model's _Can I Build design name_. The widget forwards the page's query string (series, model, …) to Lead Converter. Whether Can I Build restricts results to that design is a Can I Build account setting to confirm with them. The supplied `canibuild_custom_api.pdf` is a listing-publication API and is not used.

## DNS cutover checklist (when ready)

1. In Vercel, add `design.actonadu.com` as a domain of the Baxter project; add the DNS record Vercel shows (CNAME `cname.vercel-dns.com` or the A record) at the DNS host. SSL is issued automatically.
2. Set `CONFIGURATOR_GTM_ID=GTM-WP35BHV` so marketing tags (Analytics, Clarity, Hotjar, ads) load as on the old site. Leave it empty on staging.
3. Confirm `CONFIGURATOR_PUBLIC_HOST=design.actonadu.com` (default). Middleware serves `/design` at the root of that host; old links like `/?series=investor&model=manzanita-i448-a1&exterior=…` keep working (legacy option values are mapped).
4. In GHL, check the forms' allowed domains / Turnstile settings include `design.actonadu.com` (unchanged host, so normally nothing to do) and submit one test lead per form.
5. In Can I Build, confirm the widget token's allowed hostnames include the Baxter staging host for testing (the production host is unchanged).
6. Smoke test: Investor and Signature deep links, location popup with an in-area and an out-of-area address, porch, 9-ft, lighting, floorplan/mirror, Save and Free Quote forms, mobile.

**Rollback:** point DNS back to the old host (the legacy app is untouched), or restore a previous configurator version from Publish → Version history.

## Limitations / follow-ups

- Customer font: the live site declares Circular Pro but its font files 404, so customers see the browser's sans-serif; the rebuild matches that. Add licensed Circular Pro files to `public/configurator/fonts` with an `@font-face` if wanted.
- The legacy admin (design.actonadu.com/admin) was not used: credentials are not to be entered by an assistant, and the public catalog/quote APIs plus the asset folder were sufficient. Its region ZIP list was reconstructed by sweeping the public quote API (see the import report).
- Rate limiting on public endpoints is per server instance (Baxter's existing in-memory limiter).
