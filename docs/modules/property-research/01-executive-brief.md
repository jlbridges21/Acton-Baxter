# Property Research Tool — Executive Brief

Acton ADU · Baxter module documentation · Report version 1.0.0

---

## Objective

The Property Research Tool takes a property address and produces a sourced research report used to prepare for a Partnership Evaluation Meeting. It gathers what is publicly and commercially known about a parcel — ownership, dimensions, zoning, hazards, fire access, and the applicable ADU rules — and presents it with every figure attributed to the source that provided it.

It is the original Baxter module. The repository is named after it.

## What it produces

For one address:

- **Parcel identity** — APN, standardized address, coordinates, parcel boundary geometry
- **Property characteristics** — lot size, living area, bedrooms, bathrooms, stories, year built, property type, foundation type
- **Ownership and value** — owner name and mailing address, assessed and estimated value, last sale date and price
- **Planning** — zoning, general plan designation, historic status, and the ADU rules that apply
- **Hazards** — FEMA flood zone, CAL FIRE fire hazard severity zone, and wildland-urban interface classification
- **Fire access** — distance to the nearest mapped hydrant
- **An approximate buildable envelope** — the parcel boundary inset by the applicable ADU setbacks, drawn on a map
- **Imagery** — aerial and street-level views
- **A conflicts section** — where sources disagreed, what each said, and how to resolve it
- **A sources section** — every source queried, its status, and when it responded
- **A short AI-written narrative** summarising the report for a human reader

## The principle it is built on

**No figure appears without its source.** Every value the report shows records which provider said it, when, how confident the tool is, and what the other providers claimed instead. When two sources disagree by more than a defined threshold — three per cent on lot size, five per cent on living area, two years on year built, twenty per cent on an estimated value — the report raises a conflict rather than silently picking a winner.

This matters because the alternative is worse than useless. A single confident lot size that happens to be wrong leads to a feasibility conversation built on sand. A lot size with two sources and a flagged three per cent disagreement leads to someone checking.

## Where it works well, and where it does not

**Santa Clara County is the deep-coverage area.** Purpose-built connectors query San Jose and Santa Clara County GIS directly for parcels, zoning, and general plan designations. Those sources outrank the commercial data providers for exactly the fields where a city's own records are authoritative.

**Everywhere else is materially thinner.** A property outside those jurisdictions still gets a real report — commercial property data, federal flood maps, statewide fire hazard layers — but no city-specific zoning, no county parcel geometry, and a generic set of links in place of a jurisdiction connector.

This is an honest limitation of a tool built for a company that works primarily in one county. It is worth knowing that the report does not announce the difference as clearly as it might.

## What it costs

The tool uses **RentCast** as its primary commercial property data provider, with **ATTOM** optional and unconfigured by default.

ATTOM was evaluated at roughly **$600 per month** and dropped in favour of RentCast on cost grounds. The code still supports ATTOM fully and prefers it for several fields when a key is present, so the decision is reversible without development work — it is a configuration change.

Government and GIS sources are free. The AI narrative is a single short generation per report. Google imagery and geocoding are billed per request.

## What must be resolved

The full list with severity is in the [Specification](./02-specification.md#gaps-to-resolve).

**1. No owner is named.** Nobody is accountable for data accuracy, source health, cost, or the gaps below.

**2. The progress display is cosmetic.** While a report runs, the interface shows six named stages — confirming the address, identifying the parcel, retrieving characteristics, checking GIS, comparing sources, preparing the report. **These advance on a fixed timer, not on actual progress.** They are an animation. A report that has stalled on a slow GIS endpoint displays the same confident march through stages as one that is working. This should either be wired to real progress or stop claiming to be progress.

**3. Mock mode is on by default outside production.** Any environment not explicitly production returns a fabricated report about a reference address rather than researching the submitted one, and the result is not prominently labelled as fabricated.

**4. External GIS endpoints are outside Acton's control and several have already moved.** The code comments record endpoints that are now 404 or token-gated, and hydrant layers whose geographic coverage turned out to be narrower than their service descriptions claimed. These will break again. Health checks exist but nothing alerts.

**5. The buildable envelope is approximate and says so, but it is the most consequential number on the page.** Side and rear setbacks are applied uniformly; the larger front-yard setback is not drawn because identifying the street-facing edge automatically is unreliable. Easements, existing structures, slopes, trees, and utilities are not modelled. The disclaimer is clear and appears wherever the envelope does. The risk is that a number on a map carries more authority than the sentence beneath it.

**6. The AI narrative has no accuracy baseline.** It is constrained to the gathered facts and falls back to a deterministic summary when generation fails, which bounds the risk. Nobody has checked a sample against what a researcher would have written.

**7. Nothing is monitored.** Source health, report failure rate, provider latency, and cost are all recorded or recordable and none of them alert.

---

The complete specification, with every behaviour and every gap marked in place, is in the companion document.
