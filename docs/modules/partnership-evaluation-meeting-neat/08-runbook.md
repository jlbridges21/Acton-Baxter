# Partnership Evaluation Meeting NEAT — Operations Runbook

For whoever is on call, and for the module owner's monthly health review.

> **Nothing in this module is currently monitored or alerted.** Every check below is manual. Automating them is gap 8 in the [Specification](./02-specification.md#gaps-to-resolve).

---

## Quick reference

| Symptom                                 | Most likely cause                      | Go to                                    |
| --------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Record stuck on "Generating" forever    | Background job died                    | [§1](#1-a-record-is-stuck-generating)    |
| "Database tables are not available yet" | Migrations not applied                 | [§2](#2-migration-required)              |
| Every generation fails                  | Provider credential, model, or quota   | [§3](#3-every-generation-is-failing)     |
| Result is obviously fabricated          | Mock mode on, or genuine fabrication   | [§4](#4-a-result-looks-fabricated)       |
| Grades changed with no code deploy      | Grading standard edited                | [§5](#5-grades-changed-without-a-deploy) |
| Generation much slower than usual       | Chunking, retries, or provider latency | [§6](#6-generation-is-slow)              |
| Advisor disputes a grade                | —                                      | [§7](#7-an-advisor-disputes-a-grade)     |

---

## 1. A record is stuck "Generating"

**Symptom.** The library shows a record generating for far longer than fifteen minutes.

**Cause.** The background job died — a killed serverless invocation, a deploy mid-run, or a crash. There is no sweeper that moves abandoned records to `failed`, so it will sit there indefinitely. This is gap 5.

**Check.**

```sql
select id, prospect_name, generation_stage, generating_started_at,
       now() - generating_started_at as stuck_for
from public.pem_neats
where status = 'generating'
  and generating_started_at < now() - interval '20 minutes'
  and deleted_at is null
order by generating_started_at;
```

**Fix.** Regenerate from the result page. The concurrency lock expires after the wall-clock budget plus thirty seconds, so after about fifteen and a half minutes a new generation can start. The transcript was saved before generation began and is intact. If the stage that failed completed earlier stages, the run resumes rather than starting over.

**If it recurs**, check how far it got:

```sql
select generation_stage, count(*)
from public.pem_neats
where status = 'generating'
  and generating_started_at < now() - interval '20 minutes'
group by generation_stage;
```

A cluster on one stage points at that stage's token budget or timeout, not at infrastructure.

**Permanent fix.** A sweeper that moves records past the wall-clock budget to `failed` with an explanatory code.

---

## 2. Migration required

**Symptom.** `PEM_NEAT_MIGRATION_REQUIRED`, or "PEM NEAT database tables are not available yet."

**Cause.** Migrations 025, 027, 028, 042 have not been applied to this database.

**Fix.** Apply them in order in the Supabase SQL editor. They are reproduced verbatim in the [Code Reference](./03-code.md#migrations). Migration 043 is also needed for the editable grading standard; without it the module falls back to compiled defaults and still works.

**Verify.**

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'pem_neats'
  and column_name in ('prospect_names','generation_stage','analysis_stale','deleted_at')
order by column_name;
```

Four rows means 025, 027, 028, and 042 are all in.

---

## 3. Every generation is failing

**Check the error codes first.**

```sql
select last_error_code, count(*), max(updated_at) as most_recent
from public.pem_neats
where status = 'failed' and updated_at > now() - interval '24 hours'
group by last_error_code
order by count(*) desc;
```

| Code                           | Meaning                                           | Action                                                                        |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `AI_NOT_CONFIGURED`            | `OPENAI_API_KEY` missing                          | Set it in the environment                                                     |
| `PEM_NEAT_MODEL_NOT_AVAILABLE` | Configured model does not exist or is not enabled | Check `PEM_NEAT_OPENAI_MODEL`; set a fallback                                 |
| `PEM_NEAT_QUOTA_EXCEEDED`      | Provider quota exhausted                          | Billing. Everything else is noise until this is fixed                         |
| `PEM_NEAT_RATE_LIMITED`        | Provider rate limit                               | Usually transient; retries handle it. Sustained means the limit needs raising |
| `PEM_NEAT_TIMEOUT`             | Exceeded the budget                               | See §6                                                                        |
| `PEM_NEAT_OUTPUT_TRUNCATED`    | Hit the token ceiling                             | Raise `PEM_NEAT_MAX_OUTPUT_TOKENS`, or the transcript is unusually large      |
| `PEM_NEAT_PROVIDER_REFUSAL`    | Provider refused                                  | Inspect the transcript — unusual, worth understanding before retrying         |
| `PEM_NEAT_STORE_ERROR`         | Database write failed                             | Check Supabase health and the service-role key                                |

**Which stage.**

```sql
select failed_stage, error_code, count(*)
from public.pem_neat_generations
where status = 'failed' and created_at > now() - interval '24 hours'
group by failed_stage, error_code
order by count(*) desc;
```

Failures concentrated on one stage are a prompt or budget problem. Failures spread across stages are provider or infrastructure.

**Transcripts are safe** in every one of these cases. They are saved before generation starts.

---

## 4. A result looks fabricated

**First, check whether it is mock output.** Mock mode defaults on outside production and the interface does not label it prominently. This is gap 3 and it is the most likely explanation.

```sql
select id, prospect_name, model_provider, model_name, generated_at
from public.pem_neats where id = '<uuid>';
```

`model_provider = 'mock'` means the result is a fabricated sample about a fictional prospect and has nothing to do with the submitted transcript. Set `ENABLE_MOCK_RESEARCH=false` in that environment and regenerate.

**If the provider is real**, check what the deterministic checks found:

```sql
select generation_index, validation_issue_count,
       diagnostics_json -> 'validationDiagnostics' as diagnostics
from public.pem_neat_generations
where pem_neat_id = '<uuid>'
order by generation_index desc limit 3;
```

"Quoted evidence not found in transcript" means a quotation was fabricated. **The result was saved anyway** — the hard-fail path is declared but not wired, which is gap 4. Regenerate, and record the case; a genuine fabrication is the module's most serious failure mode and should be treated as an incident rather than a retry.

**Also check which grading standard produced it:**

```sql
select analysis_metadata -> 'gradingContentVersionNumber' as governance_version,
       analysis_metadata -> 'usedCompiledGradingFallback' as used_fallback,
       analysis_metadata -> 'transcriptStrategy' as strategy
from public.pem_neats where id = '<uuid>';
```

`used_fallback = true` means the governance store was unreachable and compiled defaults were used. The result is valid but may not reflect recent edits to the standard.

---

## 5. Grades changed without a deploy

**This is expected behaviour, not a bug.** The grading standard is editable in Admin → Baxter Governance and takes effect on the next generation with no deploy, no staging, and no review gate. See [ADR-003](./05-adrs.md#adr-003).

**Find out what changed.**

```sql
select id, prospect_name, generated_at,
       analysis_metadata -> 'gradingContentVersionNumber' as governance_version
from public.pem_neats
where status = 'completed' and deleted_at is null
order by generated_at desc limit 20;
```

A version change between two generations explains a grading change. The governance surface holds the version history and who edited it.

**If the change was unintended,** revert the governance version. Results already generated are not retroactively affected — each kept the version it used.

**Before deliberately changing the standard,** run the evaluation set from the [Test Plan](./06-test-plan-and-eval.md#proposed-evaluation-set), which does not yet exist. Until it does, a change to the grading standard is an unmeasured change to how employees are assessed.

---

## 6. Generation is slow

Normal is minutes, not seconds. Six high-effort model calls, more when chunking or correction is involved.

**Measure it.**

```sql
select
  date_trunc('day', created_at) as day,
  count(*) as generations,
  round(avg(latency_ms) / 1000.0) as avg_seconds,
  round(max(latency_ms) / 1000.0) as max_seconds
from public.pem_neat_generations
where status = 'completed' and created_at > now() - interval '30 days'
group by 1 order by 1 desc;
```

**Slower than usual, in order of likelihood:**

1. **Longer transcripts.** Over 180,000 characters triggers chunking, which adds a model call per chunk plus a merge. Check `analysis_metadata -> 'transcriptStrategy'`.
2. **Retries and corrections.** Check the stage count in `generation_trace_json`; six is normal, twenty-eight is the bounded worst case.
3. **Provider latency.** Compare against the provider's own status.

---

## 7. An advisor disputes a grade

This will happen, and the module produces employee performance assessments, so handle it properly.

**What you can show them.** Every generation is kept with its evidence, its model, and the grading standard version it used. Nothing is overwritten.

```sql
select generation_index, created_at, model_name,
       structured_result -> 'assessment' -> 'categories' as categories
from public.pem_neat_generations
where pem_neat_id = '<uuid>' and status = 'completed'
order by generation_index;
```

**What you cannot show them.** There is no measured agreement rate between this module's grades and a human sales leader's. If the advisor asks how often the module is right, the honest answer today is that nobody knows. That is gap 6, and this situation is exactly why it matters.

**In the meantime:** the assessment is a coaching input, not a performance rating. Treat a dispute as a reason to read the evidence together, and record the case as a candidate for the evaluation set.

---

## Monthly health review

For the module owner, once one is named.

**1. Failure rate.**

```sql
select
  date_trunc('week', created_at) as week,
  count(*) filter (where status = 'completed') as succeeded,
  count(*) filter (where status = 'failed') as failed,
  round(100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0), 1) as failure_pct
from public.pem_neat_generations
where created_at > now() - interval '90 days'
group by 1 order by 1 desc;
```

**2. Cost.**

```sql
select
  date_trunc('month', created_at) as month,
  count(*) as generations,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  round(avg(input_tokens + output_tokens)) as avg_tokens_per_generation
from public.pem_neat_generations
where status = 'completed' and created_at > now() - interval '6 months'
group by 1 order by 1 desc;
```

Multiply by the current rate for the configured model. A rising average per generation means retries and corrections are firing more often, which is a quality signal as much as a cost one.

**3. Validation issues.**

```sql
select
  date_trunc('week', created_at) as week,
  count(*) as generations,
  sum(validation_issue_count) as total_issues,
  count(*) filter (where validation_issue_count > 0) as with_issues
from public.pem_neat_generations
where status = 'completed' and created_at > now() - interval '90 days'
group by 1 order by 1 desc;
```

A rising trend means output quality is drifting. Since nothing blocks on these, this query is the only place that drift becomes visible.

**4. Stuck records.** Query in §1. Should be zero.

**5. Fallback usage.**

```sql
select count(*) filter (where (analysis_metadata ->> 'usedCompiledGradingFallback')::boolean) as used_fallback,
       count(*) as total
from public.pem_neats
where generated_at > now() - interval '30 days';
```

Any non-zero count means the governance store was unreachable during a generation. Worth understanding.

**6. Export the live grading standard** to this folder. It is database content and is not in version control. If the database is lost and no export exists, Acton's sales methodology has to be rewritten from memory.

---

## Incident severity

| Severity   | Example                                                                                         | Response                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **High**   | Fabricated evidence shown to an advisor as real; transcripts exposed outside Acton              | Stop use of the module. Preserve the generation record. Postmortem required |
| **Medium** | All generations failing; grading standard changed unintentionally and results were acted on     | Fix within the working day. Notify users who generated during the window    |
| **Low**    | Individual stuck record; one slow generation; a single failed generation that succeeds on retry | Fix when convenient. Note it if it recurs                                   |

A high-severity incident gets a blameless postmortem: what happened, what the impact was, why it was possible, and what changes so it is not possible again. The last part is the only one that matters.
