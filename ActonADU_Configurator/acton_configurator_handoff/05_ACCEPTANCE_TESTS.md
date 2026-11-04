# Acceptance Tests / Definition of Done

## Entry and admin
- [ ] Baxter admin clicks Configurator tool and lands on admin dashboard.
- [ ] Non-admin cannot access/administer or read drafts, even with direct URL/API calls.
- [ ] Admin creates a new model in the correct series, edits specs, uploads images, and publishes without JSON/manual IDs.
- [ ] Global interior/exterior styles can be assigned across models with model-specific renders/prices.
- [ ] Admin updates individual regional prices in style drill-down and sees changes in bulk grid (single source of truth).
- [ ] Region assignments are by city, not ZIP; duplicate city assignments rejected; newly created models inherit regions.
- [ ] Copy/fill, keyboard input and bulk pricing changes work and report validation errors clearly.
- [ ] Existing published configuration stays live while edits are draft; admin preview displays draft; Publish moves approved changes live.
- [ ] Unverified $0 model prices and missing required renders are identified and blocked from accidental live publication.

## Customer parity
- [ ] Compare current and new public configurator side by side on desktop and mobile with matching screenshots.
- [ ] No Baxter login required to use public configurator.
- [ ] Investor model with no options goes from Choose Model directly to Exteriors.
- [ ] Signature Cypress has Standard/With Porch step and distinct correct images/prices.
- [ ] Correct ordered steps thereafter: Exterior, Interior, Appliances, Upgrades, Bathroom, Free Quote.
- [ ] Selecting each interior shows `Kitchen` first, then correct follow-up image behavior.
- [ ] Lifestyle and Premium display `Appliance Base` and `Appliance Mid` respectively for selected interior.
- [ ] Lighting Upgrade displays `Lighting Dusk Uplights`, not `Lighting Dusk`.
- [ ] 8-foot↔9-foot toggles change the appropriate exterior and interior images, even after back navigation.
- [ ] Ceiling height does not incorrectly change bathroom/appliance images.
- [ ] Swapping models preserves compatible options and resets incompatible ones without broken render or stale total.
- [ ] Existing floorplan / mirror controls and save/quote behaviors operate as verified in legacy site.

## Address and pricing
- [ ] Price is obscured on first load and no gated price is exposed through API/markup prevalidation.
- [ ] Clicking blurred price opens existing-style `We'll need your location` modal and GHL address form.
- [ ] Supported city selects correct unique region; regional model and selected option amounts sum correctly.
- [ ] Unsupported city shows outside-service-area modal, still permits browsing, with prices hidden.
- [ ] Changing address to another supported city recalculates all model and option pricing.
- [ ] Financing estimate presentation and calculation match verified original or discrepancies are flagged.

## Integrations and launch
- [ ] Existing GHL quote and address-pricing form IDs and embed endpoints remain unchanged.
- [ ] Test form leads reach intended GHL workflows; verify fields/consent; no double submissions.
- [ ] Existing-style property-check trigger works; document Can I Build compatibility and any deferral.
- [ ] Existing and representative query/deep links load the corresponding selection where possible.
- [ ] All imported images have provenance; report missing and ambiguous variants.
- [ ] Staged Baxter-hosted frontend works; old `design.actonadu.com` remains untouched.
- [ ] Delivery notes include admin/public URLs, setup tasks, evidence of tests, gaps, and eventual DNS cutover steps.
