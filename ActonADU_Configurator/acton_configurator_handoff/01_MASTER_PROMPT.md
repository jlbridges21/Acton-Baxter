# Claude Code Master Prompt — Acton ADU Configurator in Baxter

You are working inside the existing **Baxter** application/codebase. Build a new, fully functional **Acton ADU Configurator** tool, including (1) a public customer-facing configurator and (2) a radically simpler, visual admin management experience for Baxter admins.

**Read all accompanying documents in this handoff folder before planning or writing code:** `02_PRODUCT_AND_UX_SPEC.md`, `03_ASSET_AND_RENDERING_RULES.md`, `04_INTEGRATIONS_AND_MIGRATION.md`, and `05_ACCEPTANCE_TESTS.md`. Review the supplied screenshots and admin mockup images, the existing live configurator at `https://design.actonadu.com/`, the existing admin at `https://design.actonadu.com/admin/` if authorized access is available, and the `Models/` folder in Baxter's project root. These are reference materials. The existing live frontend is the source of truth for its visual appearance and established behaviors; the detailed requirements below take precedence for requested improvements.

## Mission

Recreate the **customer experience almost identically** to the existing Acton ADU configurator—same visual layout, two-column proportions, large renderings, step sequence, interactions, image changes, floorplan/mirror controls where applicable, bottom-right pricing presentation, address-pricing gate, property-check launch, quote form, and responsive behavior. This is **not a customer-facing redesign**. Improve quality and reliability without making it look different.

In contrast, replace the existing difficult, text-heavy backend with a modern **visual, low-click management tool** that a nontechnical Acton administrator can use confidently to create a model, assign shared styles, upload and map renderings, set region-specific model and option prices, preview the actual customer result, and publish safely. Treat the supplied admin mockups as design direction rather than literal implementation instructions. Keep terminology consistent and avoid unnecessary navigation, hidden configuration, or technical concepts in the UI.

## Where it lives and who can access it

- This is a new **tool inside the current Baxter application**, leveraging its existing auth, admin permissions, data infrastructure, deployment conventions, and UI patterns where reasonable. Examine the existing architecture first; do not unnecessarily duplicate services or break other Baxter tools.
- When a **Baxter admin** opens Configurator from Baxter navigation, land on the **Configurator Admin** workspace by default, not the customer configurator. Provide a prominent **View/Preview Live Configurator** action.
- The **customer-facing configurator must be accessible publicly without Baxter login**, initially from a safe Baxter-hosted URL, while keeping the existing `design.actonadu.com` unchanged during testing. Later migration to `design.actonadu.com` will occur when DNS access is available; implement a deployment approach that permits this with minimal rework.
- Only Baxter users with existing **admin** permissions can edit and publish configurator content; implement access checks server-side as well as in UI. Draft and unpublished data must not leak into public output.

## Customer-facing requirements (visual parity)

Use real screenshots, the existing site, and sample URLs to reproduce the current experience faithfully. The fixed primary progression is:

1. **Choose a Model** (with the series/model list as currently displayed)
2. **Model Options** — **only if the selected model has configured options**. For example, Signature Series Cypress S748 B1 has Standard and With Porch, while Investor models without options skip this step entirely.
3. **Exterior Styles**
4. **Interior Styles**
5. **Appliances**
6. **Upgrades**
7. **Bathroom**
8. **Free Quote / Get in Touch**

Keep the existing customer presentation and step transitions. Preserve changing the model, navigating backward, selectable cards, price adjustments, and render changes. On a model change, try to preserve selections valid for the new model and reset only selections that are unavailable. Ensure resulting rendering and pricing are always internally consistent.

The floating bottom-right starting price and financing presentation must remain **blurred/hidden until the customer provides a valid address**. Clicking the obscured pricing triggers the existing-style **“We'll need your location”** popup using the existing GoHighLevel address-pricing form integration. The customer's **city** determines their region and regional prices (never infer region using ZIP alone). A city can belong to only one region. If the city is not assigned to any supported region, show an **outside our service area** message and allow continued model exploration **without showing pricing**. Avoid exposing price through hidden text, API responses, UI state, URL parameters, or accessible rendered markup before successful location resolution.

Preserve the **“Check to see if this plan works on your property”** link and property-check popup / Can I Build path. The Can I Build integration is desirable for v1, but **must not block delivery** if their widget/API cannot provide required model filtering or property checks. Implement a clear interface boundary, preserve the existing launch flow as far as possible, and document precisely what works and what still requires provider information. Do not make unsupported claims about capability.

Preserve the existing GoHighLevel embedded form integration, exact form destinations, consent/captcha behavior, and tracking when rebuilding the quote and address-gating flows; avoid changing their GHL workflow/webhook contracts. Investigate whether the current form passes selections and prices; preserve existing field mappings where verifiable and document ambiguities for testing.

The current configurator can be observed through examples:
- Investor model URL: `https://design.actonadu.com/?series=investor&model=manzanita-i448-a1`
- Signature model URL: `https://design.actonadu.com/?series=signature&model=cypress-s748-b1`

Preserve/parse existing externally shared deep links and selection query parameters to the extent supported, with a compatibility test suite. Avoid coupling core content IDs to display names. Test on desktop and mobile.

## Visual admin workspace

Design a highly intuitive **Models Library**, with series grouping, image thumbnails, model name, specs, publication status, rendering completeness, regional pricing completeness, edit/duplicate and preview. Create a model through a guided but efficient process. Each model workspace should have immediately understandable sections: Overview / Model Options / Exteriors / Interiors / Appliances / Upgrades / Bathrooms / Images / Pricing / Preview, adjusted to sensible organization.

Style editors must show visual cards (not text-only lists); on a single page, let admins edit name, default status, availability on the model, pricing, associated image renderings, and regional price differences. Reuse common **global interior/exterior styles** across models while keeping model-specific image sets and model-specific or region-specific pricing. Make bulk selection/reuse, duplicate, and copy-to-model easy.

The **Regional Pricing** UI is a central feature:
- Manage named regions by **city membership** using searchable city selection/chips; cities belong to only one region, and the interface prevents conflicts/duplicates.
- Every model inherits the full set of configured regions automatically.
- Admins can choose **explicit amounts** or **default base + regional dollar or percentage adjustments** for model and options. Support both without forcing one universal scheme.
- Offer a **bulk spreadsheet-style pricing matrix** with models/styles/options as rows and regions as columns, direct inline editing, keyboard navigation, fill/copy, bulk percent/dollar updates, and one save action.
- The same source of prices must also be editable from a **Pricing by Region tab within each individual model/style/option**. Never maintain two independently saved copies.
- Clearly separate model base prices from **incremental option prices**, with a live preview of the actual customer total for a selected city and set of options.
- Imported/unverified prices may be **$0 placeholders**, clearly identified as needing review and not mistaken for approved real customer prices. Prevent accidental publication of unapproved placeholder prices, while allowing admins to intentionally approve a zero-cost option.

Image management should feel like a visual gallery that understands customer viewing contexts. Use drag/drop, auto-detection from filenames/folders, clear thumbnails and labels (Kitchen, Appliances Base, Appliances Mid, Lighting Daytime, Lighting Dusk Uplights, ceiling height, porch, exterior style, etc.). Show rendering-combination completeness and warnings for missing assets. Users must be able to override auto-matches and preview any specific combination. There should be no requirement for admins to memorize IDs or edit JSON.

Add **Draft → Preview → Publish** workflows: edits to published models are drafted; previews render unpublished changes for admins; the public experience changes only on publish. Include validation, clear publication status, rollback/version history where practical, and helpful errors rather than silent failures.

## Image selection is contextual

Selection state can change images across multiple steps. **Nine-foot ceiling** impacts both exterior and interior images (including when the user navigates back to prior steps). **Porch/standard** can change exterior renders, combined with exterior style. **Interior style** determines kitchen imagery and appliance variant images. **Premium vs Lifestyle appliances** uses the appropriate specific rendering. **Lighting Upgrade** uses Lighting Dusk Uplights, not Lighting Dusk. Full rules and folder expectations are in the image specification. Handle rendering dependencies centrally, not as hardcoded conditionals scattered among UI components.

## Existing image assets

At the Baxter root is `Models/`, containing `Investor Series/` and `Signature Series/`, with folders per model and the renderings/floorplans. No reliable pricing metadata or spreadsheet exists in these folders. Inspect and classify assets, establish mappings and aliases, and bulk-import useful images. **Do not invent images or silently associate ambiguous assets**. Provide a clear, actionable missing/ambiguous assets report. Support editing mappings through admin UI. Do not require the owner to manually reupload everything that already exists.

## Integrations and staging

- GHL get-in-touch form: `https://api.leadconnectorhq.com/widget/form/p1swLQWD4mVI7APiGzFp`
- GHL location-pricing form: `https://api.leadconnectorhq.com/widget/form/pV3Gf1zaZHLuCTipKGKZ`
- GHL embed script: `https://link.msgsndr.com/js/form_embed.js`
- Can I Build is **optional for the first release**, but the existing widget/property-check experience should remain available if possible. The uploaded `canibuild_custom_api.pdf` describes **XML property listing publication**, not a proven property-search or model-filtering API. Investigate the widget separately and request missing documentation only if actually needed. Keep credentials server-side.
- Reconstruct existing prices only where feasible; accuracy is uncertain. Mark unverified pricing for review, and prefer safe placeholders in admin rather than fake verified public prices.
- Never copy passwords/API tokens into code, documentation, commits, or client bundles. Use Baxter's existing secure secret/env conventions.

## Process and definition of done

1. Audit Baxter and the provided models folder; examine existing public frontend and available admin behavior/screenshots; produce a concise parity and implementation plan before substantial changes.
2. Implement the backend and intuitive admin UX using existing Baxter conventions. Import and classify assets. Build pricing regions and image resolution.
3. Build the customer frontend matching the existing UI precisely, including conditional steps, image transitions, address-gated region prices, floorplan/mirror toggles and forms.
4. Integrate GHL and pursue Can I Build only to the extent the provider supports. Make any unsolved provider limitation explicit, not hidden.
5. Perform screenshot-by-screenshot comparisons, comprehensive functional tests (see acceptance tests), security checks and migration verification. Fix regressions rather than declaring success prematurely.
6. Deploy a staging/public Baxter-hosted URL without replacing `design.actonadu.com`. Provide admin and public URLs, configuration prerequisites, completed-vs-pending feature list, assets report, test results, and a DNS cutover checklist for later.

Make your own architecture and implementation decisions after inspecting the real codebase. Avoid unnecessary back-and-forth on details you can discover; ask the user only when a decision is genuinely blocked. Build production-quality, maintainable code. **Do not change unrelated Baxter functionality.**
