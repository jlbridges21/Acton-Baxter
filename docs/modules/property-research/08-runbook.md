# Property Research Tool — Operations Runbook

For whoever is on call, and for the module owner's monthly health review.

> **Nothing in this module is alerted on.** Connector health checks exist and are recorded; nothing watches them. Automating that is gap 8.

> **The failure mode to fear is silence.** A hazard layer that moves does not return an error — it returns no features, and no features looks exactly like no hazard. Most of this runbook is about telling those two apart.

---

## Quick reference

| Symptom                                            | Most likely cause                              | Go to                                        |
| -------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| A report failed                                    | Provider error, timeout, or address resolution | [§1](#1-a-report-failed)                     |
| A report is stuck researching                      | In-flight state lost, or a hung outbound call  | [§2](#2-a-report-is-stuck-researching)       |
| A number looks wrong                               | Source precedence, or a stale provider record  | [§3](#3-a-number-looks-wrong)                |
| No hazard data, or "no hazard" that seems unlikely | Endpoint moved — **check before believing it** | [§4](#4-hazard-data-missing-or-suspicious)   |
| No hydrants found                                  | Genuinely outside a mapped layer               | [§5](#5-no-hydrants-found)                   |
| Buildable envelope missing or tiny                 | Geometry, or no rules for the jurisdiction     | [§6](#6-buildable-envelope-problems)         |
| Report full of plausible but wrong details         | **Mock mode**                                  | [§7](#7-the-report-is-fabricated)            |
| Narrative missing or generic                       | AI fell back to deterministic                  | [§8](#8-the-narrative-is-missing-or-generic) |

---

## 1. A report failed

```sql
select id, input_address, status, error_message,
       started_at, completed_at, created_at
from public.reports
where status = 'failed' and created_at > now() - interval '7 days'
order by created_at desc;
```

**Which sources failed on that report:**

```sql
select source_name, source_type, status, http_status,
       response_time_ms, status_message, endpoint_name
from public.report_sources
where report_id = '<uuid>'
order by status, source_name;
```

This table is the module's best diagnostic — it records sources that failed as well as those that answered.

| Pattern                                        | Meaning                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| RentCast `error`                               | Primary provider down or key invalid. Nothing else can compensate |
| ATTOM `unavailable` with an "optional" message | **Normal.** ATTOM is off by design                                |
| Several GIS sources `error`                    | Network, or an endpoint moved — see §4                            |
| One city connector `error`                     | That jurisdiction's GIS; the report degrades rather than failing  |

Retry from the report page. The address is stored, so nothing is lost.

---

## 2. A report is stuck researching

```sql
select id, input_address, status, started_at,
       now() - started_at as running_for
from public.reports
where status = 'researching' and started_at < now() - interval '15 minutes'
order by started_at;
```

**Why this happens.** The in-flight guard and the stage counter are **module-level in-memory structures**. In serverless they do not survive across invocations and are not shared between instances, so a run that ended with the instance leaves the row in `researching` with nothing tracking it. This is gap 5.

**Fix.** Retry the report, which clears research children and re-runs. A stale-recovery path exists (`stale-recovery.ts`) — check whether it ran before retrying by hand.

**Permanent fix.** Move in-flight tracking to the database, which already has `started_at` and `status`.

---

## 3. A number looks wrong

**First, see what every source said.** The answer is usually here.

```sql
select c.field_key, c.source_name, c.source_type,
       c.raw_value, c.normalized_value, c.match_score, c.is_preferred
from public.property_source_claims c
where c.report_id = '<uuid>' and c.field_key = 'lot_sq_ft'
order by c.is_preferred desc, c.source_name;
```

**And whether a conflict was raised:**

```sql
select field_label, severity, description,
       values_json, recommended_resolution
from public.report_conflicts
where report_id = '<uuid>';
```

**Three possibilities:**

1. **Sources disagreed and a conflict was raised.** Working as designed — the report is telling you to check. The recommended resolution says where.
2. **Sources disagreed within threshold.** Lot size differing by 2% does not flag. If that matters for this field, the threshold is the thing to revisit, not the report.
3. **One source, and it is wrong.** The commercial provider's record is stale or mismatched. Check `match_score` and the standardized address — a low score suggests it matched the wrong property.

**If the preferred source looks like the wrong choice**, the weights are in `select-preferred-fact.ts`. City GIS outranks commercial providers for jurisdiction facts by design. Changing weights affects every future report, so rerun the ground-truth set from the [Test Plan](./06-test-plan-and-eval.md#part-2--proposed-ground-truth-set) first.

**If the APN is wrong, stop.** Every downstream lookup used it, so the whole report is about a different property. Do not fix fields individually — correct the address and re-run.

---

## 4. Hazard data missing or suspicious

**Treat "no flood zone" with suspicion until you have confirmed the endpoint is alive.** The two look identical from the report.

```sql
select source_name, status, http_status, response_time_ms, status_message
from public.report_sources
where report_id = '<uuid>'
  and (source_name ilike '%fema%' or source_name ilike '%fire%' or source_name ilike '%wui%');
```

`status = 'ok'` with no hazard value is a real answer. `error` or `manual_review` is not.

**Verify the endpoint directly** with a known point. The URLs are in `src/lib/providers/hazards/config.ts` and are reproduced in the [Code Reference](./03-code.md#hazard-endpoints).

```bash
curl -s "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=-121.8863,37.3382&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json" | head -c 500
```

**Known fragility, already recorded in the config comments:** the official CAL FIRE WUI MapServer and the FRAP image and feature servers are 404 or token-gated for anonymous clients, which is why a specific alternative host is used, with a documented fallback. If both WUI hosts fail, WUI is absent — which is correct behaviour, but the report should not be read as "not in WUI".

**If an endpoint has moved**, update the config, verify with a known point, and **record what you found in the comment**. Those comments are the module's accumulated knowledge about these services.

---

## 5. No hydrants found

Usually correct, and usually because the property is outside any mapped layer.

**Real coverage, which differs from what the service descriptions claim:**

| Source                | Actual extent                                                                 |
| --------------------- | ----------------------------------------------------------------------------- |
| Santa Clara city SCFD | Santa Clara **city** only. Not Los Altos, not south San Jose                  |
| Campbell Public Works | **Campbell-local**, despite claiming San Jose Water fusion                    |
| OpenStreetMap         | Patchy. Los Altos has coverage; south San Jose often does not within 2,500 ft |

A property in south San Jose with no hydrant result is the expected outcome, not a bug. The report offers a manual lookup link for exactly this case.

**When to suspect a real problem:** a property in Santa Clara city or Campbell with no result. Check whether that layer responded at all.

Remember the caveat applies to every result: straight-line distance, not path of travel. The real measurement is longer.

---

## 6. Buildable envelope problems

**No envelope at all.** Check for parcel geometry and for rules:

```sql
select (select count(*) from public.parcel_geometry where report_id = r.id) as has_geometry,
       r.jurisdiction_name, r.apn
from public.reports r where r.id = '<uuid>';

select jurisdiction_key, rule_key, zone_key, value_json, source_citation
from public.jurisdiction_rules
where jurisdiction_key = '<key>'
order by rule_key, zone_key nulls first;
```

No geometry means no county parcel layer for that address — expected outside the covered counties. No rules means nothing to inset by.

**An implausibly small envelope.** Either the setbacks genuinely consume the lot, which has its own message, or the rules are wrong. Check the `source_citation` on each rule and read the ordinance it cites.

**An envelope that looks too generous on the street side.** Expected. The front-yard setback is listed but not drawn — identifying the street-facing edge automatically is unreliable. See [ADR-007](./05-adrs.md#adr-007).

> If a user is treating the envelope as a buildable area rather than an approximation, that is a conversation rather than a bug. The disclaimer is correct, complete, and attached wherever the envelope appears — and a shaded polygon with a number still carries more authority than a sentence beneath it.

---

## 7. The report is fabricated

Plausible-looking details that have nothing to do with the address almost always mean **mock mode**.

```sql
select id, input_address, standardized_address, ai_provider,
       (select count(*) from public.report_sources s
        where s.report_id = r.id and s.source_type = 'mock') as mock_sources
from public.reports r where r.id = '<uuid>';
```

Any `mock` source rows mean the report is fabricated. The data model is honest about it — mock sources weigh zero and are typed as mock — but the interface does not say so loudly. This is gap 3.

Set `ENABLE_MOCK_RESEARCH=false` in that environment and re-run.

---

## 8. The narrative is missing or generic

```sql
select ai_provider, ai_model, ai_generation_status,
       ai_prompt_version, ai_generated_at
from public.reports where id = '<uuid>';
```

| Status     | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `success`  | Model-generated                                                        |
| `fallback` | Model failed; deterministic summary used. **Report is still complete** |
| `skipped`  | No provider configured                                                 |
| `error`    | Generation errored; the report is unaffected                           |

The narrative is a convenience over a report that is already complete. `fallback` is the system working as designed — see [ADR-010](./05-adrs.md#adr-010). Check `AI_PROVIDER` and the relevant API key if every report is falling back.

---

## Monthly health review

**1. Endpoint health — the most important check in this runbook.**

```sql
select connector_key, source_name, status, checked_at,
       response_time_ms, message
from public.connector_health_checks
where checked_at > now() - interval '30 days'
order by checked_at desc limit 50;
```

Then run the known-point verification in the [Test Plan](./06-test-plan-and-eval.md#part-3--endpoint-health-verification) for every hazard and hydrant layer. **A liveness ping is not enough** — a service can respond and return nothing useful.

**2. Report failure rate.**

```sql
select date_trunc('week', created_at) as week,
       count(*) filter (where status = 'complete') as complete,
       count(*) filter (where status = 'failed') as failed,
       count(*) filter (where status = 'researching') as stuck
from public.reports
where created_at > now() - interval '90 days'
group by 1 order by 1 desc;
```

`stuck` should be zero for any week older than a day.

**3. Source reliability.**

```sql
select source_name,
       count(*) as queried,
       count(*) filter (where status = 'active') as ok,
       count(*) filter (where status = 'error') as errors,
       round(avg(response_time_ms)) as avg_ms
from public.report_sources
where created_at > now() - interval '30 days'
group by source_name
order by errors desc, queried desc;
```

A source whose error rate is climbing is an endpoint about to move.

**4. Conflict rate.** A field whose conflict rate suddenly rises usually means a provider changed its data, not that properties changed.

```sql
select field_label, severity, count(*)
from public.report_conflicts
where created_at > now() - interval '90 days'
group by 1, 2 order by 3 desc;
```

**5. Coverage mix.** How many reports are getting the fallback connector rather than a real one — this is the number that would justify building another jurisdiction connector.

```sql
select jurisdiction_name, count(*)
from public.reports
where created_at > now() - interval '90 days' and status = 'complete'
group by 1 order by 2 desc;
```

**6. Export `jurisdiction_rules`** to this folder. The query is in the [Code Reference](./03-code.md#extracting-a-complete-current-bundle). They are admin-maintained rows with citations, they drive the buildable envelope, and they are not in version control.

---

## Incident severity

| Severity   | Example                                                                                                                                         | Response                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **High**   | A hazard layer silently returning nothing, so reports said "no flood zone" when properties were in one; a wrong APN propagating through reports | Stop relying on affected reports and identify which are affected by date. Postmortem required |
| **Medium** | Primary provider down; all reports failing; buildable envelopes wrong for a jurisdiction                                                        | Fix within the working day                                                                    |
| **Low**    | One failed report; one stuck report; a single source erroring intermittently                                                                    | Fix when convenient. Note if it recurs                                                        |

A high-severity incident gets a blameless postmortem. For this module the postmortem should always answer one extra question: **was a wrong number used in a customer conversation, and which reports need re-running?** The data to answer that is in `report_sources` and `property_source_claims`, which is exactly why they are stored.
