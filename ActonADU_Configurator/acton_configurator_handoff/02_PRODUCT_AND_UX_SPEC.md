# Product and UX Specification

## Product boundaries
Two experiences share published configuration data: (1) Baxter **admin workspace** for admins only; (2) **public customer configurator** with no login. V1 public route is Baxter-hosted; later move/canonical domain `design.actonadu.com` once DNS is available. Existing design.actonadu.com stays live during development.

## Customer-facing fidelity
Reproduce existing two-panel design, image gallery/render presentation, typography/layout, option cards and selected states, scroll/step behavior, bottom price/financing footer, Save controls, floorplan and mirror model interactions, quote page and modals. Existing screenshots and live site are visual source of truth; no general redesign.

### Exact progression
`Choose Model → [Model Options, only if model has them] → Exterior Styles → Interior Styles → Appliances → Upgrades → Bathroom → Free Quote`.
- Signature Cypress s748 B1: `Standard` and `With Porch`, with distinct exterior renderings; existing examples indicate a porch adds pricing.
- Investor models without Model Options: skip step cleanly and entirely.
- Back navigation and model change retain valid selections when possible, reset incompatible ones, and recompute all images/prices.
- Individual selections generally remain combinable; no blanket restrictions.

### Customer pricing gate
- Bottom-right `Starting at` / payment estimate hidden or blurred until a validated customer address resolves to a supported **city**.
- Clicking blurred price shows `We'll need your location` modal and existing GHL form.
- City is uniquely assigned to one region; unlisted city => outside service area notice; browsing remains possible without revealing prices.
- Pricing engine: region-specific model base + selected region-specific options/upgrade increments (including model options, exterior, interior, appliance, ceiling/lighting, bathroom) + whatever financing rules are verified in original. Pricing is synchronized across every screen and quote; never show stale totals.
- ZIP can help address validation/autocomplete but **cannot be sole region matching key**. Normalize city names safely and use address locality/state as needed to disambiguate same-named cities.
- Default and zero pricing for imported data are **unverified** until admin review; define publication safeguards for models with missing/placeholder real prices.

### Property check / Can I Build
- Preserve `Check to see if this plan works on your property` UI and existing property-check modal as closely as possible.
- Prefer passing selected model/series/address to the widget and restricting the design list, but graceful fallback to provider's available results is acceptable. No claim of model-restriction support without verification.
- Do not delay functioning core configurator if Can I Build API/widget cannot be confirmed for V1.

### Lead capture
- Free Quote form uses existing GoHighLevel form; retain fields, embed conventions, consent/captcha, routing and submission side effects.
- Existing pricing-gate form also uses GoHighLevel. Verify address capture and pricing visibility are tied to a real validated region selection, not just arbitrary form completion.
- Preserve existing externally shared query parameters/links if possible. Preserve selected configuration in any user-visible quote summary or confirmed CRM field mappings, without inventing unsupported hidden fields.

## Admin information architecture
- Sidebar: **Configurator**. Landing page: summary/models library with search, Series filter, cards/thumbnails, Active/Draft/Needs Attention, price/render completeness; `Add Model`; `Preview Live`.
- Single-model workspace: model overview and specs, model options (if any), exteriors, interiors, appliances, upgrades, bathrooms, media/floorplans, pricing, and preview. Use sections/tabs or cards, not nested navigation mazes.
- Shared style library: common interior and exterior names available across models; assignment to a model enables its **own renders, adjustments, defaults, availability**. Avoid confusing global rename propagation; show clear used-in relationships.
- Individual style page: thumbnail, editable name/description/default/availability, categorized images and mapping, **Pricing by Region** tab with inline regional values; status and preview always visible.
- Bulk pricing: grid mode across models and their suboptions, regions as columns; switch between categories, filter to model/series, paste from spreadsheet, fill/copy, bulk adjust, keyboard navigation, highlight unsaved cells.
- Regions page: region name, optional color, searchable **city** selectors; unique assignments enforced; conflict warnings; coverage and missing cities reporting; automatic inheritance for all models.
- Admin data entry should be forgiving: undo, clear save states, inline error explanations, no backend IDs/JSON in normal UI.
- Preview exactly what customers see with selectable location and selections; draft preview private, live preview public.
- Draft/publish separation: publish validates missing required renders, region coverage/pricing, unresolved defaults/invalid combinations; intentional zero-cost option is valid, unreviewed zero model price is not.

## Pricing examples only
Past screenshot prices are **illustrative and may be outdated**. Do not treat them as canonical. Import if reliable, mark as unverified, enable simple admin correction; zero placeholders are permitted in draft.
