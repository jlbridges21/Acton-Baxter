# Property Research Tool — Test Plan and Evaluation

---

## The distinction that matters

**Does it work?** Does the pipeline run, do providers normalise correctly, does fact selection pick the right source, does conflict detection fire at the right thresholds. There are 14 test files and roughly 3,200 lines covering this well.

**Is it right?** When the report says the lot is 6,250 square feet, is it? When it says the parcel is in flood zone X, is it?

**The second question has no systematic answer.** There is no set of properties with verified ground truth from county records against which the tool's output is compared. For a tool whose numbers inform feasibility conversations with customers, that is the most important thing not being measured.

---

## Part 1 — Existing automated coverage

### How to run it

```bash
npm run format && npm run lint && npm run typecheck && npm run test && npm run build
```

This module only:

```bash
npx vitest run tests/unit/live-research-pipeline.test.ts \
  tests/unit/rentcast-only-attom-optional.test.ts \
  tests/unit/conflict-detector.test.ts \
  tests/unit/buildable-envelope.test.ts \
  tests/unit/hazards-flood-fire-wui.test.ts \
  tests/unit/hydrant-fire-access.test.ts \
  tests/unit/jurisdiction-building-codes.test.ts \
  tests/unit/attom-provider.test.ts tests/unit/rentcast-provider.test.ts \
  tests/unit/parcel-overlay-and-easements.test.ts \
  tests/unit/property-research-queue-foundation.test.ts \
  tests/unit/ai-report.test.ts tests/unit/report-normalization.test.ts \
  tests/unit/report-presentation.test.tsx
```

### The suites

| File                                         | Lines | Covers                                                                                                                                                         |
| -------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live-research-pipeline.test.ts`             | 495   | Orchestration end to end: provider fan-out, claim assembly, fact selection, conflicts                                                                          |
| `rentcast-only-attom-optional.test.ts`       | 446   | **The ATTOM-off path.** Audits which fields ATTOM alone claimed, and verifies RentCast-only mode produces a complete report with ATTOM recorded as unavailable |
| `property-research-queue-foundation.test.ts` | 346   | Enqueueing, and recovery of reports stuck in `researching`                                                                                                     |
| `buildable-envelope.test.ts`                 | 290   | Envelope geometry, degenerate cases, the parcel overlay path                                                                                                   |
| `report-presentation.test.tsx`               | 283   | Summary chips, section navigation                                                                                                                              |
| `hydrant-fire-access.test.ts`                | 242   | Distance maths and the source priority ladder                                                                                                                  |
| `parcel-overlay-and-easements.test.ts`       | 224   | Static Maps overlay, APN-first easement and tract-map workflow                                                                                                 |
| `jurisdiction-building-codes.test.ts`        | 184   | Jurisdiction key resolution, rule keys, **citation requirements**                                                                                              |
| `ai-report.test.ts`                          | 173   | Narrative generation, sanitisation, fallback                                                                                                                   |
| `hazards-flood-fire-wui.test.ts`             | 159   | FEMA descriptions and combined hazard lookup                                                                                                                   |
| `attom-provider.test.ts`                     | 144   | ATTOM normalizer and client                                                                                                                                    |
| `conflict-detector.test.ts`                  | 115   | Percentage difference and threshold behaviour                                                                                                                  |
| `rentcast-provider.test.ts`                  | 112   | RentCast normalizer and matching                                                                                                                               |
| `report-normalization.test.ts`               | 13    | Report normalisation                                                                                                                                           |

### What this covers well

The ATTOM-optional path is genuinely well tested, which matters because it is the configuration actually running — a test suite that only exercised the both-providers path would be testing a configuration nobody uses.

Conflict thresholds, envelope degenerate cases, and the hydrant priority ladder are all covered. Citation requirements on jurisdiction rules are enforced in tests as well as by the database.

### What it does not cover

- **Whether any number is correct.** Providers are mocked. Nothing compares output to county records.
- **Live endpoint availability.** Hazard and hydrant endpoints are stubbed. A layer that 404s in production passes every test.
- **Coverage-depth differences.** Nothing asserts that a fallback-connector report is distinguishable from a San Jose one.
- **The progress display.** Nothing asserts the stages mean anything, because they do not.
- **Concurrent runs of the same report**, which the in-memory guard does not actually prevent in serverless.
- **Cost or latency regression.**

---

## Part 2 — Proposed ground-truth set

This is the thing worth building next. It needs someone who can read a county record, not primarily an engineer.

### Construction

**Sample.** Twelve to twenty real properties, chosen deliberately:

- Four in San Jose — the full-coverage path
- Three elsewhere in Santa Clara County — county connector, no city zoning
- Three elsewhere in California — fallback connector
- One outside California — minimal coverage
- At least one in a flood zone, one in a high fire hazard severity zone, and one in WUI
- At least one with an unusual parcel shape, where the envelope inset is non-trivial
- At least one where providers are known to disagree

**Ground truth.** For each, record from the authoritative source — county assessor, city zoning map, FEMA map service centre — the APN, lot size, living area, year built, zoning, general plan, flood zone, and fire hazard zone. This is the expensive part and there is no shortcut.

**Storage.** In this folder. These are public records about real properties; still, note that owner names and mailing addresses should not be copied into the ground-truth file.

### What to measure

| Measure                                  | Definition                                               | Suggested bar |
| ---------------------------------------- | -------------------------------------------------------- | ------------- |
| **APN accuracy**                         | Reported APN matches the county record                   | **100%**      |
| Lot size accuracy                        | Within 3% of the county record                           | ≥ 90%         |
| Living area accuracy                     | Within 5%                                                | ≥ 85%         |
| Year built accuracy                      | Within 2 years                                           | ≥ 90%         |
| **Zoning accuracy (full-coverage area)** | Matches the city zoning map                              | **≥ 95%**     |
| **Flood zone accuracy**                  | Matches FEMA                                             | **100%**      |
| Fire hazard zone accuracy                | Matches CAL FIRE                                         | 100%          |
| Conflict precision                       | Flagged conflicts are real disagreements, not formatting | ≥ 90%         |
| Conflict recall                          | Real disagreements get flagged                           | ≥ 90%         |
| **Fabrication rate**                     | Any value with no source behind it                       | **0**         |

The bolded rows should block. **APN is the foundation** — a wrong APN means every downstream lookup is about a different property, and nothing else in the report can be trusted. Flood and fire zones come from authoritative point-in-polygon queries and should be exactly right or honestly absent; a wrong hazard zone is the error most likely to cause real harm.

### When to run it

- Before changing source weights, per-field bonuses, or conflict thresholds
- Before adding, removing, or re-enabling a data provider — including switching ATTOM back on
- After any external endpoint change
- Quarterly regardless, because the underlying data changes and endpoints move

---

## Part 3 — Endpoint health verification

**Separate from the test suite and more urgent.** The module depends on roughly ten third-party endpoints outside Acton's control, and the config comments already record several that moved or became token-gated.

Monthly, for each of FEMA NFHL layer 28, CAL FIRE FHSZ SRA and LRA, CAL FIRE WUI primary and fallback, Santa Clara County parcels, San Jose parcels and zoning and general plan, Santa Clara city SCFD hydrants, Campbell hydrants, and OSM Overpass:

- [ ] The endpoint responds
- [ ] A known point returns the expected value
- [ ] The response schema still has the fields the normalizer reads
- [ ] The layer's effective date has not changed without the constants being updated

**A moved hazard layer does not fail loudly.** It returns nothing, and nothing looks identical to no hazard. That is the failure mode to guard against, and it is why a known-point check matters more than a liveness ping.

---

## Part 4 — Red team

Not currently performed.

**Address ambiguity.** An address matching several parcels, an address that geocodes to a neighbouring parcel, a new subdivision absent from county GIS. The tool should report uncertainty rather than confidently pick one.

**Parcel-point mismatch.** A geocoded point falling just outside the true parcel boundary. Hazard lookups are point-in-polygon; a point on the wrong side of a flood zone boundary gives a wrong answer with full confidence.

**Degenerate geometry.** A flag lot, an easement-carved parcel, a parcel whose setbacks consume it. Covered in unit tests; worth confirming against real geometry.

**Provider disagreement at the threshold.** Values differing by exactly 3% on lot size — does it flag, and is that the intended behaviour at the boundary?

**Stale endpoint.** Point a hazard lookup at a URL returning an empty feature set and confirm the report says "no data" rather than "no hazard". **This is the single most valuable red-team test in the module.**

---

## Part 5 — Definition of Done

- [ ] `npm run format && npm run lint && npm run typecheck && npm run test && npm run build` all pass
- [ ] New behaviour has a test; a fixed bug has a regression test naming the case
- [ ] If a provider, weight, bonus, or threshold changed, the ground-truth set was rerun and results recorded here
- [ ] **If an external endpoint was added or changed, it was verified live with a known point, and the config comment records what was found**
- [ ] If the report schema changed, existing stored reports still render
- [ ] The [Changelog](./07-changelog.md) is updated in the same commit
- [ ] If a decision was made, an [ADR](./05-adrs.md) records it
- [ ] If a gap was closed, the [Specification](./02-specification.md#gaps-to-resolve) table is updated
