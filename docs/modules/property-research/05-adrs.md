# Property Research Tool — Architecture Decision Records

An ADR records a significant decision and why it was made, so someone later can tell a deliberate choice from an accident.

Reconstructed from the implementation, its comments, migration notes, and product direction. Where the original reasoning was not recorded anywhere, that is stated rather than guessed at.

---

## ADR-001 — Claims are stored separately from facts

**Status:** Accepted · Evident from the schema, which dates to migration 001

**Context.** Several providers answer the same question about a property and frequently disagree. The obvious approach is to pick the best provider and store one value per field.

**Decision.** Store **every claim from every source** in `property_source_claims`, then select **one fact per field** into `property_facts`, then record disagreements beyond threshold in `report_conflicts`. The report shows the selected fact and the disagreement where one exists.

**Why.** A single confident number that happens to be wrong is worse than useless, because it leads to a feasibility conversation built on it. A number with its source, its competitors, and a flagged disagreement leads to someone checking. The schema makes the audit trail structural rather than optional — you cannot store a fact without having stored the claims it came from.

**Consequences.** Three tables and a selection step where one table would do. Every provider must return claims, not values. Adding a provider never changes existing data, it adds claims — which is why ATTOM can be switched on and off by configuration. This is the decision everything else in the module rests on.

---

## ADR-002 — Fact selection is deterministic weights, not a model

**Status:** Accepted · Explicit in `select-preferred-fact.ts`

**Decision.** Score each claim by source type, plus a per-field bonus for sources known to be authoritative for that specific field. Highest score wins. No model is involved.

**Why.** The file comment states the principle: _"Official GIS outranks licensed APIs for jurisdiction facts."_ San Jose knows San Jose's zoning better than a national aggregator. Santa Clara County knows its own parcels. A commercial provider knows building characteristics better than a GIS layer that does not carry them.

That knowledge is stable, auditable, and explainable to a user who asks why a number was chosen. A model would be none of those things.

**Consequences.** The weights and bonuses are the module's actual intelligence and must be maintained as sources change. They are the single highest-value artifact to preserve in a rebuild — the code around them can be rewritten from a specification, but the accumulated knowledge of which source is right about what cannot.

---

## ADR-003 — Conflicts are surfaced, never silently resolved

**Status:** Accepted · Evident from the schema and thresholds

**Decision.** When claims differ beyond a per-field threshold — 3% on lot size, 5% on living area, 2 years on year built, 20% on estimated value — record a conflict with every competing value, its source, a severity, and a recommended resolution.

APN is compared **canonically**, with punctuation and case stripped, so formatting differences between a county and a commercial provider do not raise a false conflict while a genuinely different parcel does.

**Why.** Disagreement between sources is information about the property, not noise to be cleaned up. A lot size that two sources disagree on by 8% is a fact worth knowing before quoting a project.

**Consequences.** Reports show conflicts that a simpler tool would hide. Thresholds are judgement calls and are tuned per field — tight on lot size because it drives the envelope, loose on estimated value because valuation models legitimately differ.

---

## ADR-004 — RentCast is primary; ATTOM is optional and currently off

**Status:** Accepted · Explicit product direction

**Context.** ATTOM is a comprehensive licensed property data provider at roughly **$600 per month**. RentCast covers much of the same ground for substantially less.

**Decision.** RentCast is the primary provider and is always queried. ATTOM runs only when `ATTOM_API_KEY` is set, which it is not. When absent, the report records ATTOM as `unavailable` with an explicit message saying it is optional and RentCast is primary.

**Why.** This was an explicit decision during development: ATTOM was too expensive to justify, and RentCast was chosen in its place.

**Consequences.** The integration remains complete and the per-field bonuses still prefer ATTOM for living area, bedrooms, bathrooms, and estimated value — so re-enabling it is a configuration change rather than development work. Both are queried with `Promise.allSettled` so neither can block the other.

The honest cost of the decision is thinner building-characteristic data, and fewer independent sources to detect conflicts with. The report records ATTOM's absence rather than hiding it, which is the right way to carry a cost decision.

---

## ADR-005 — Every external endpoint is verified live before being wired in

**Status:** Accepted · Explicit in the config comments

**Context.** Public GIS services are documented inconsistently and move without notice.

**Decision.** Verify each endpoint with a real point-in-polygon query before using it, and **record what was found in the config file as a comment**.

**Why.** The comments are the evidence this was necessary. From the hazards config: the official CAL FIRE WUI MapServer and the FRAP image and feature servers are _"currently 404 or token-gated for anonymous clients"_, so a specific alternative host is used. From the hydrants config: the Campbell layer's service description claims it is sourced _"from San Jose Water, fused"_ but its actual extent is Campbell-local, not citywide San Jose, and the origin field is null on every feature.

**Neither of those is discoverable from documentation.** Both were found by testing, and both would have produced silently wrong reports — a hydrant layer that does not cover an address returns no hydrants, which looks identical to no hydrants existing.

**Consequences.** Adding a source costs more up front. The comments are documentation that must be maintained with the endpoints. These URLs will break again; see gap 4.

---

## ADR-006 — Hazard and hydrant caveats are mandatory and attached at the source

**Status:** Accepted · Explicit in constants and config

**Decision.** Two caveats are constants, not UI copy, and travel with the data:

- **WUI:** _"screen-level indicator — verify parcel-specific WUI status with the local jurisdiction."_ CAL FIRE documents WUI as a relative-risk screen, not a parcel-level designation.
- **Hydrant distance:** _"Actual hydrant pull distance is measured along the path of travel and will be longer — measure on site."_

**Why.** Both numbers look more precise than they are. A WUI classification reads like a determination about the parcel; it is not. A hydrant distance reads like what a fire marshal will measure; it is a straight line, and the real measurement follows the driveway.

Keeping them as constants attached to the data means a new display surface cannot forget them.

**Consequences.** The report is wordier. That is the correct trade for a number someone may quote to a customer.

---

## ADR-007 — The buildable envelope models side and rear setbacks only

**Status:** Accepted · Explicit in `buildable-envelope.ts`

**Context.** The envelope is the most useful thing on the report and the easiest to get dangerously wrong.

**Decision.** Inset the parcel polygon uniformly by the **maximum of the available side and rear setbacks**. Do not draw the front-yard setback. List it for reference instead.

**Why.** Stated directly in the code: _"identifying the street-facing edge automatically is unreliable."_ A wrongly-oriented front setback would carve the envelope out of the wrong side of the lot and look authoritative doing it. A uniform inset is honestly approximate; a confidently wrong one is not.

**Consequences.** The envelope is larger than reality on the street-facing side, which the disclaimer says explicitly. Three degenerate cases have their own wording rather than a blank map: setbacks consuming the lot, geometry that will not inset cleanly, and an area below 25 square feet.

The disclaimer appears wherever the envelope does — map caption, area figure, and section. It is correct and complete, and it is still the module's weakest point, because a shaded polygon with a number carries more authority than the sentence beneath it. See gap in the [Specification](./02-specification.md#6-the-buildable-envelope).

---

## ADR-008 — Setback rules live in a citation-required admin table

**Status:** Accepted · Migration 041

**Decision.** `jurisdiction_rules` holds setbacks and ADU size limits keyed by jurisdiction, rule key, and optional zone key. **`source_citation` is `not null`.** A rule can also link to the knowledge entry it came from.

**Why.** A setback that drives a drawn envelope must be traceable to an ordinance. Making the citation a database constraint means an uncited rule cannot exist, rather than relying on discipline.

Rule keys are application vocabulary rather than a database enum, so a new rule type does not need a migration.

**Consequences.** Someone must maintain these rules per jurisdiction, and that person needs to read ordinances rather than write code — which is why the [Module Record](./04-module-record.md#ownership) lists it as a separate ownership role. The envelope records whether it used zone-specific rules or fell back to general ones, so a reader can tell how precise the basis was.

---

## ADR-009 — Jurisdiction connectors, with a fallback rather than a failure

**Status:** Accepted · Evident from the registry

**Decision.** A connector interface with implementations for San Jose and Santa Clara County, selected city-first, then county, then a generic fallback.

**Why.** Acton works primarily in Santa Clara County, so depth there is worth purpose-built connectors. An address elsewhere should still produce a useful report rather than an error — the fallback supplies generic links, and statewide and federal layers still apply.

**Consequences.** Coverage depth varies enormously by location and the report does not signal that as loudly as it should — gap 6. Adding a jurisdiction means writing a connector, which is real work; the fallback is what makes that optional rather than blocking.

---

## ADR-010 — The AI narrative degrades to a deterministic summary

**Status:** Accepted · Evident from the provider structure

**Decision.** Three providers — Anthropic, OpenAI, and a **deterministic** provider that composes a summary from the facts with no model at all. Input is sanitised to gathered facts only, with critical fields tracked explicitly. Generation status is recorded as `success`, `fallback`, `skipped`, or `error`, along with the provider, model, prompt version, and a hash of the input.

**Why.** The narrative is a convenience over a report that is already complete without it. It must never block a report, and it must never invent a fact the research did not find. Tracking critical fields explicitly lets the narrative say what is missing rather than filling the gap.

**Consequences.** A report is never blocked by model availability. Every narrative is traceable to the data it was written from. The deterministic provider is also what makes the module testable without a model.

---

## ADR-011 — Refreshes create lineage rather than overwriting

**Status:** Accepted · Migration 003

**Decision.** A refresh clears research children, re-runs, and records a `refresh_reason`. `parent_report_id` links a report to its predecessor.

**Why.** Property data changes — a sale, a rezoning, a new hazard map. Knowing a report was refreshed, when, and why is part of knowing whether to trust it.

**Consequences.** Report history carries chains rather than single rows.

---

## Decisions not recorded

Honest gaps. Questions a future engineer will ask that this folder cannot answer:

- **Why the conflict thresholds are 3%, 5%, 2 years, and 20%.** They are plausible and clearly field-specific, but whether they were derived from observed provider disagreement or chosen by judgement is not recorded. This matters: they decide what a user is shown as a problem.
- **Why the hydrant search radius is 2,500 feet.** It is close to common fire-access requirements, but the basis is not stated.
- **Why the progress display animates on a timer** rather than reporting real pipeline milestones. The pipeline has natural ones. This reads as a placeholder that was never replaced — see [Specification § 8.1](./02-specification.md#81-progress-reporting).
- **Why in-flight tracking is in-memory** rather than in the database, which already has the columns. Likely predates the serverless deployment, where it stopped working.
- **Why the per-field source bonuses have the specific values they do.** The ordering is clearly deliberate; the magnitudes are not explained.
